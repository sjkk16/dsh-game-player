#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Forms = System.Windows.Forms;
namespace GamePlayer.Desktop;

internal readonly record struct RawKeyboardPacket(IntPtr Device, ushort Scan, ushort Flags, ushort VirtualKey, uint Message, uint Extra);
internal readonly record struct RawKeyEvent(int Key, bool Down, bool Transient);
internal static class KeyboardObservationRules {
    internal static string Backend(bool rawRegistered, bool hookInstalled) => rawRegistered ? "raw-input" : hookInstalled ? "hook" : "unavailable";
    internal static bool AcceptHook(bool rawRegistered, string source) => source == "external" || (!rawRegistered && source == "human");
    internal static bool Decode(RawKeyboardPacket packet, out RawKeyEvent value) {
        value = default;
        // Device-less events and our own tag are not evidence of physical human input.
        if (packet.Device == IntPtr.Zero || packet.Extra == 0x44534847 || packet.VirtualKey is 0 or 255 || packet.Scan == 255 || (packet.Flags & ~7) != 0) return false;
        bool down = (packet.Flags & 1) == 0, extended = (packet.Flags & 2) != 0, e1 = (packet.Flags & 4) != 0;
        if (packet.Message != (down ? 0x100u : 0x101u) && packet.Message != (down ? 0x104u : 0x105u)) return false;
        // PrintScreen's synthetic E0 Shift and Pause's E1 prefix are not held modifiers.
        if (extended && (packet.VirtualKey is 16 or 160 or 161)) return false;
        if (e1 && packet.VirtualKey != 19) return false;
        int key = HumanInputObserver.KeyCode(packet.VirtualKey, packet.Scan, extended ? 1u : 0u);
        if (key < 1 || key > 256) return false;
        // Pause can arrive without a break. It is a tap, not an indefinitely held key.
        value = new(key, down, packet.VirtualKey == 19 && down);
        return true;
    }
}

// Per-device ownership prevents an unplug or release on one keyboard releasing another.
internal sealed class RawKeyboardState {
    readonly Dictionary<IntPtr, HashSet<int>> devices = new();
    readonly HashSet<int> held = new();
    internal IEnumerable<int> Held => held;
    internal bool Apply(IntPtr device, RawKeyEvent value) {
        if (device == IntPtr.Zero || value.Key < 1 || value.Key > 256) return false;
        if (!devices.TryGetValue(device, out var keys)) {
            if (!value.Down || devices.Count >= 64) return false;
            devices[device] = keys = new();
        }
        if (value.Down) { if (!keys.Add(value.Key)) return false; return held.Add(value.Key); }
        if (!keys.Remove(value.Key)) return false;
        if (keys.Count == 0) devices.Remove(device);
        if (devices.Values.Any(other => other.Contains(value.Key))) return false;
        return held.Remove(value.Key);
    }
    internal bool Remove(IntPtr device) {
        if (!devices.Remove(device)) return false;
        var remaining = new HashSet<int>(devices.Values.SelectMany(keys => keys));
        bool changed = !held.SetEquals(remaining); held.Clear(); held.UnionWith(remaining); return changed;
    }
    internal void Clear() { devices.Clear(); held.Clear(); }
}

// The only keyboard Raw Input registration in this process. Created/destroyed on the
// observer thread, never on the model's WPF/WebView dispatcher and never focusable.
internal sealed class RawKeyboardSink : Forms.NativeWindow, IDisposable {
    const uint InputSink = 0x100, DeviceNotify = 0x2000, Remove = 1, InputCommand = 0x10000003;
    readonly Action<RawKeyboardPacket> receive;
    readonly Action<IntPtr> removeDevice;
    internal bool Registered { get; private set; }
    internal int RegistrationError { get; private set; }
    internal long ReadErrors { get; private set; }
    internal RawKeyboardSink(Action<RawKeyboardPacket> receive, Action<IntPtr> removeDevice) { this.receive = receive; this.removeDevice = removeDevice; }
    internal bool Open() {
        try {
            CreateHandle(new Forms.CreateParams { Caption = "DSH read-only keyboard receiver", Parent = new IntPtr(-3) });
            var device = new RawDevice { UsagePage = 1, Usage = 6, Flags = InputSink | DeviceNotify, Target = Handle };
            Registered = RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf<RawDevice>());
            if (!Registered) RegistrationError = Marshal.GetLastWin32Error();
        } catch (Exception e) { RegistrationError = e is System.ComponentModel.Win32Exception win32 ? win32.NativeErrorCode : e.HResult; }
        if (!Registered && Handle != IntPtr.Zero) DestroyHandle();
        return Registered;
    }
    protected override void WndProc(ref Forms.Message message) {
        try {
            if (Registered && message.Msg == 0xff) Read(message.LParam);
            else if (Registered && message.Msg == 0xfe && message.WParam.ToInt64() == 2) removeDevice(message.LParam);
        } catch { ReadErrors++; /* Observation must never interfere with another application's input. */ }
        // DefWindowProc also performs the required WM_INPUT cleanup.
        base.WndProc(ref message);
    }
    void Read(IntPtr handle) {
        uint size = 0, headerSize = (uint)Marshal.SizeOf<RawHeader>();
        if (GetRawInputData(handle, InputCommand, IntPtr.Zero, ref size, headerSize) == uint.MaxValue || size < headerSize + Marshal.SizeOf<RawKey>() || size > 4096) { ReadErrors++; return; }
        uint capacity = size;
        IntPtr buffer = Marshal.AllocHGlobal((int)capacity);
        try {
            uint received = GetRawInputData(handle, InputCommand, buffer, ref size, headerSize);
            if (received == uint.MaxValue || received != size || received > capacity || size < headerSize + Marshal.SizeOf<RawKey>()) { ReadErrors++; return; }
            var header = Marshal.PtrToStructure<RawHeader>(buffer);
            if (header.Type != 1 || header.Size != received) { ReadErrors++; return; }
            var key = Marshal.PtrToStructure<RawKey>(IntPtr.Add(buffer, (int)headerSize));
            receive(new(header.Device, key.Scan, key.Flags, key.VirtualKey, key.Message, key.Extra));
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    public void Dispose() {
        if (Registered) {
            RegisterRawInputDevices(new[] { new RawDevice { UsagePage = 1, Usage = 6, Flags = Remove, Target = IntPtr.Zero } }, 1, (uint)Marshal.SizeOf<RawDevice>());
            Registered = false;
        }
        if (Handle != IntPtr.Zero) DestroyHandle();
    }
    [StructLayout(LayoutKind.Sequential)] struct RawDevice { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)] struct RawHeader { public uint Type, Size; public IntPtr Device; public UIntPtr WParam; }
    [StructLayout(LayoutKind.Sequential)] struct RawKey { public ushort Scan, Flags, Reserved, VirtualKey; public uint Message, Extra; }
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool RegisterRawInputDevices([In] RawDevice[] devices, uint count, uint size);
    [DllImport("user32.dll", SetLastError = true)] static extern uint GetRawInputData(IntPtr handle, uint command, IntPtr data, ref uint size, uint headerSize);
}
