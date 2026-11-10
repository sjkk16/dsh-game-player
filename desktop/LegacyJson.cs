#nullable enable
// Small compatibility shim lets the existing display-only keyboard renderer run
// in .NET 10 as well as in its standalone Windows PowerShell 5.1 fallback.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
namespace System.Web.Script.Serialization {
    public sealed class JavaScriptSerializer {
        public int MaxJsonLength { get; set; }=65536;
        public T Deserialize<T>(string text) {
            if(text.Length>MaxJsonLength)throw new InvalidOperationException("JSON too long");
            using var doc=JsonDocument.Parse(text,new JsonDocumentOptions{MaxDepth=32});return (T)ConvertValue(doc.RootElement)!;
        }
        static object? ConvertValue(JsonElement e)=>e.ValueKind switch {
            JsonValueKind.Object=>e.EnumerateObject().ToDictionary(p=>p.Name,p=>ConvertValue(p.Value)),
            JsonValueKind.Array=>e.EnumerateArray().Select(ConvertValue).ToArray(),
            JsonValueKind.String=>e.GetString(),JsonValueKind.Number=>e.TryGetInt64(out var i)?(object)i:e.GetDouble(),
            JsonValueKind.True=>true,JsonValueKind.False=>false,_=>null
        };
        public string Serialize(object value)=>JsonSerializer.Serialize(value);
    }
}
