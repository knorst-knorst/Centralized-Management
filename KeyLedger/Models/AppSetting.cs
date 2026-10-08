namespace KeyLedger.Models;

public sealed class AppSetting
{
    public int Id { get; set; }
    public string GroupName { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public bool IsSecret { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}