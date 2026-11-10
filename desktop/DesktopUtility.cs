#nullable enable
using System;
using System.Collections.Generic;
using System.Buffers.Binary;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using Forms = System.Windows.Forms;

namespace GamePlayer.Desktop;
internal static class DesktopUtility {
    static (int Width,int Height) Dimensions(byte[] b) {
        int U16(int p)=>BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(p,2));
        if(b.Length>=24&&b.Take(8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}))return(BinaryPrimitives.ReadInt32BigEndian(b.AsSpan(16,4)),BinaryPrimitives.ReadInt32BigEndian(b.AsSpan(20,4)));
        if(b.Length>=26&&b[0]==66&&b[1]==77){
            int header=BinaryPrimitives.ReadInt32LittleEndian(b.AsSpan(14,4));
            if(header==12)return(BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(18,2)),BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(20,2)));
            if(header>=40&&b.Length>=54)return(BinaryPrimitives.ReadInt32LittleEndian(b.AsSpan(18,4)),checked((int)Math.Abs((long)BinaryPrimitives.ReadInt32LittleEndian(b.AsSpan(22,4)))));
        }
        if(b.Length>=4&&b[0]==255&&b[1]==216){
            int p=2;
            while(p+3<b.Length){
                if(b[p++]!=255)throw new InvalidDataException("Invalid JPEG marker.");
                while(p<b.Length&&b[p]==255)p++;
                if(p>=b.Length)break;int marker=b[p++];
                if(marker==1||marker>=208&&marker<=217)continue;
                if(p+2>b.Length)break;int length=U16(p);
                if(length<2||p+length>b.Length)break;
                if(marker>=192&&marker<=207&&marker!=196&&marker!=200&&marker!=204){if(length<8)break;return(U16(p+5),U16(p+3));}
                if(marker==218)break;p+=length;
            }
        }
        throw new InvalidDataException("Unsupported or malformed keyboard image header.");
    }
    public static int Run(Dictionary<string, string> args) {
        using var parent = new ParentWatch(int.Parse(args["--parent"]));
        using var timer = new Timer(_ => { if (parent.HasExited) Environment.Exit(1); }, null, 1000, 1000);
        if (args.TryGetValue("--describe-model-source", out string? describe)) {
            using var source = ModelSource.Open(describe);
            Console.WriteLine(JsonSerializer.Serialize(new { root=source.Root, zip=source.IsZip, files=source.Names, selectedFile=source.SelectedFile })); return 0;
        }
        if (args.TryGetValue("--discover-model", out string? modelSource)) {
            Console.WriteLine(JsonSerializer.Serialize(new { candidates = ModelDiscovery.Discover(modelSource) })); return 0;
        }
        if (args.TryGetValue("--validate-skin", out string? selected)) {
            string path = Path.GetFullPath(selected);
            if (path.StartsWith("\\\\") || !new[] { ".png", ".jpg", ".jpeg", ".bmp" }.Contains(Path.GetExtension(path).ToLowerInvariant())) throw new InvalidDataException("Unsupported local keyboard image.");
            if(new FileInfo(path).Length>8L*1024*1024)throw new InvalidDataException("Keyboard image must be at most 8 MiB.");
            byte[] bytes = File.ReadAllBytes(path);
            if (bytes.Length == 0 || bytes.Length > 8 * 1024 * 1024) throw new InvalidDataException("Keyboard image must be at most 8 MiB.");
            var dimensions=Dimensions(bytes);if(dimensions.Width<1||dimensions.Height<1||dimensions.Width>8192||dimensions.Height>8192||(long)dimensions.Width*dimensions.Height>32*1024*1024)throw new InvalidDataException("Keyboard image dimensions exceed the import budget.");
            using var stream = new MemoryStream(bytes, false);
            using var image = System.Drawing.Image.FromStream(stream, false, true);
            if (image.Width < 1 || image.Height < 1 || image.Width > 8192 || image.Height > 8192 || (long)image.Width * image.Height > 32 * 1024 * 1024) throw new InvalidDataException("Keyboard image dimensions exceed the import budget.");
            Console.WriteLine(JsonSerializer.Serialize(new { width = image.Width, height = image.Height, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() })); return 0;
        }
        Forms.Application.EnableVisualStyles(); string mode = args["--pick"]; string? result = null;
        if (mode == "model-folder") {
            using var dialog = new Forms.FolderBrowserDialog { Description = "选择包含 Live2D 模型的文件夹", UseDescriptionForTitle = true };
            if (dialog.ShowDialog() == Forms.DialogResult.OK) result = dialog.SelectedPath;
        } else {
            using var dialog = new Forms.OpenFileDialog { CheckFileExists = true, Multiselect = false, RestoreDirectory = true };
            (dialog.Title, dialog.Filter) = mode switch {
                "model-file" => ("选择 Live2D 模型", "Live2D 模型或压缩包|*.model3.json;*.zip|模型文件|*.model3.json|ZIP 压缩包|*.zip"),
                "profile" => ("选择参数适配文件", "适配 JSON|*.json"),
                "keyboard-image" => ("选择键盘图片", "键盘图片|*.png;*.jpg;*.jpeg;*.bmp"),
                _ => throw new InvalidDataException("Unknown picker mode")
            };
            if (dialog.ShowDialog() == Forms.DialogResult.OK) result = dialog.FileName;
        }
        Console.WriteLine(JsonSerializer.Serialize(new { path = result == null ? null : Path.GetFullPath(result) })); return 0;
    }
}
