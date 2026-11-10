#nullable enable
using System;
using System.IO;
namespace GamePlayer.Desktop;
public static class ModelLoadSelection {
    // An explicitly selected source must never silently fall back to another model.
    public static string? Resolve(string? selected, string? fallback) {
        if (!string.IsNullOrWhiteSpace(selected)) return selected;
        if (string.IsNullOrWhiteSpace(fallback)) return null;
        return File.Exists(Path.Combine(fallback, "img", "standard", "cat_model", "deepseek.model3.json")) ? fallback : null;
    }
}
