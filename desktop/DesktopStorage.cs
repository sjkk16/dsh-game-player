#nullable enable
using System;
using System.IO;
namespace GamePlayer.Desktop;
internal static class DesktopStorage {
    // Resolve valid local directory links, but never create an unknown link's missing target.
    public static string EnsureDirectory(string path) {
        string full = Path.GetFullPath(path), root = Path.GetPathRoot(full)!;
        string current = root;
        foreach (string segment in full[root.Length..].Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries)) {
            current = Path.Combine(current, segment);
            FileAttributes attributes;
            try { attributes = File.GetAttributes(current); }
            catch (Exception e) when (e is FileNotFoundException || e is DirectoryNotFoundException) {
                if (new DirectoryInfo(current).LinkTarget != null) throw new IOException("Broken directory link: " + current, e);
                Directory.CreateDirectory(current); attributes = File.GetAttributes(current);
            }
            if ((attributes & FileAttributes.ReparsePoint) != 0) {
                var target = new DirectoryInfo(current).ResolveLinkTarget(true);
                if (target is not DirectoryInfo || !target.Exists) throw new IOException("Broken directory link: " + current + " -> " + target?.FullName);
                current = Path.GetFullPath(target.FullName);
            } else if ((attributes & FileAttributes.Directory) == 0) throw new IOException("Storage path is not a directory: " + current);
        }
        return current;
    }
    public static (string Root, string Directory) PrepareCache(string dataDirectory, bool qa = false) {
        string data = EnsureDirectory(dataDirectory);
        string root = qa ? data : EnsureDirectory(Path.Combine(data, "webview-cache"));
        string directory = Path.Combine(root, qa ? "webview-cache-" + Environment.ProcessId : Guid.NewGuid().ToString("N"));
        if (Directory.Exists(directory) || File.Exists(directory)) throw new IOException("Private renderer cache already exists: " + directory);
        Directory.CreateDirectory(directory);
        string probe = Path.Combine(directory, ".write-probe");
        try { using (var stream = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None)) stream.WriteByte(0); File.Delete(probe); }
        catch { try { if (File.Exists(probe)) File.Delete(probe); if (Directory.GetFileSystemEntries(directory).Length == 0) Directory.Delete(directory); } catch { } throw; }
        return (root, directory);
    }
}
