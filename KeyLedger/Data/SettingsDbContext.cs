using KeyLedger.Models;
using Microsoft.EntityFrameworkCore;

namespace KeyLedger.Data;

public sealed class SettingsDbContext(DbContextOptions<SettingsDbContext> options) : DbContext(options)
{
    public DbSet<AppSetting> Settings => Set<AppSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var setting = modelBuilder.Entity<AppSetting>();
        setting.ToTable("APP_SETTINGS");
        setting.HasKey(item => item.Id);
        setting.Property(item => item.Id).HasColumnName("ID").ValueGeneratedOnAdd();
        setting.Property(item => item.GroupName).HasColumnName("GROUP_NAME").HasMaxLength(80).IsRequired();
        setting.Property(item => item.Key).HasColumnName("SETTING_KEY").HasMaxLength(180).IsRequired();
        setting.Property(item => item.Value).HasColumnName("SETTING_VALUE").HasMaxLength(4000).IsRequired();
        setting.Property(item => item.IsSecret).HasColumnName("IS_SECRET").IsRequired();
        setting.Property(item => item.UpdatedAtUtc).HasColumnName("UPDATED_UTC").IsRequired();
        setting.HasIndex(item => new { item.GroupName, item.Key }).IsUnique();
    }
}