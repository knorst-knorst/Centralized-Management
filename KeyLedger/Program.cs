using System.Security.Cryptography;
using System.Text;
using KeyLedger.Data;
using KeyLedger.Models;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var provider = builder.Configuration["Database:Provider"] ?? "Sqlite";
var connectionString = builder.Configuration.GetConnectionString("Settings")
	?? "Data Source=keyledger.db";

builder.Services.AddDbContext<SettingsDbContext>(options =>
{
	switch (provider.Trim().ToLowerInvariant())
	{
		case "sqlite":
			options.UseSqlite(connectionString);
			break;
		case "sqlserver":
			options.UseSqlServer(connectionString);
			break;
		case "oracle":
			options.UseOracle(connectionString);
			break;
		default:
			throw new InvalidOperationException(
				$"Unsupported Database:Provider '{provider}'. Use Sqlite, SqlServer, or Oracle.");
	}
});

var app = builder.Build();
var apiKey = app.Configuration["Api:Key"];

app.Use(async (context, next) =>
{
	if (!string.IsNullOrWhiteSpace(apiKey)
		&& context.Request.Path.StartsWithSegments("/api"))
	{
		var suppliedKey = context.Request.Headers["X-Api-Key"].ToString();
		var expectedBytes = Encoding.UTF8.GetBytes(apiKey);
		var suppliedBytes = Encoding.UTF8.GetBytes(suppliedKey);

		if (!CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes))
		{
			context.Response.StatusCode = StatusCodes.Status401Unauthorized;
			await context.Response.WriteAsJsonAsync(new { error = "A valid X-Api-Key header is required." });
			return;
		}
	}

	await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/status", async (SettingsDbContext db) => Results.Ok(new
{
	database = provider,
	connected = await db.Database.CanConnectAsync(),
	apiKeyRequired = !string.IsNullOrWhiteSpace(apiKey)
}));

app.MapGet("/api/settings", async (SettingsDbContext db, string? group, string? search) =>
{
	var query = db.Settings.AsNoTracking();
	if (!string.IsNullOrWhiteSpace(group))
	{
		query = query.Where(setting => setting.GroupName == group);
	}

	if (!string.IsNullOrWhiteSpace(search))
	{
		query = query.Where(setting => setting.Key.Contains(search)
			|| setting.GroupName.Contains(search));
	}

	var settings = await query.OrderBy(setting => setting.GroupName)
		.ThenBy(setting => setting.Key)
		.Select(setting => new SettingResponse(
			setting.Id,
			setting.GroupName,
			setting.Key,
			setting.IsSecret ? null : setting.Value,
			setting.IsSecret,
			setting.UpdatedAtUtc))
		.ToListAsync();

	return Results.Ok(settings);
});

app.MapGet("/api/groups", async (SettingsDbContext db) =>
{
	var groups = await db.Settings.AsNoTracking()
		.GroupBy(setting => setting.GroupName)
		.Select(group => new
		{
			name = group.Key,
			count = group.Count(),
			secretCount = group.Count(setting => setting.IsSecret)
		})
		.OrderBy(group => group.name)
		.ToListAsync();

	return Results.Ok(groups);
});

app.MapGet("/api/settings/export", async (SettingsDbContext db, string? group) =>
{
	var query = db.Settings.AsNoTracking();
	if (!string.IsNullOrWhiteSpace(group))
	{
		query = query.Where(setting => setting.GroupName == group);
	}

	var settings = await query.OrderBy(setting => setting.GroupName)
		.ThenBy(setting => setting.Key)
		.ToListAsync();
	var groups = settings.GroupBy(setting => setting.GroupName)
		.ToDictionary(
			settingGroup => settingGroup.Key,
			settingGroup => settingGroup.ToDictionary(setting => setting.Key, setting => setting.Value));

	return Results.Ok(new
	{
		exportedAtUtc = DateTime.UtcNow,
		count = settings.Count,
		groups
	});
});

app.MapPost("/api/settings", async (SettingsDbContext db, SettingInput input) =>
{
	if (!TryNormalize(input, out var groupName, out var key, out var error))
	{
		return Results.ValidationProblem(new Dictionary<string, string[]> { ["setting"] = [error] });
	}

	if (await db.Settings.AnyAsync(setting => setting.GroupName == groupName && setting.Key == key))
	{
		return Results.Conflict(new { error = "A setting with this key already exists in that group." });
	}

	var setting = new AppSetting
	{
		GroupName = groupName,
		Key = key,
		Value = input.Value ?? string.Empty,
		IsSecret = input.IsSecret,
		UpdatedAtUtc = DateTime.UtcNow
	};

	db.Settings.Add(setting);
	await db.SaveChangesAsync();
	return Results.Created($"/api/settings/{setting.Id}", ToResponse(setting));
});

app.MapPut("/api/settings/{id:int}", async (int id, SettingsDbContext db, SettingInput input) =>
{
	if (!TryNormalize(input, out var groupName, out var key, out var error))
	{
		return Results.ValidationProblem(new Dictionary<string, string[]> { ["setting"] = [error] });
	}

	var setting = await db.Settings.FindAsync(id);
	if (setting is null)
	{
		return Results.NotFound();
	}

	if (await db.Settings.AnyAsync(existing => existing.Id != id
		&& existing.GroupName == groupName
		&& existing.Key == key))
	{
		return Results.Conflict(new { error = "A setting with this key already exists in that group." });
	}

	setting.GroupName = groupName;
	setting.Key = key;
	if (!setting.IsSecret || !input.IsSecret || !string.IsNullOrEmpty(input.Value))
	{
		setting.Value = input.Value ?? string.Empty;
	}
	setting.IsSecret = input.IsSecret;
	setting.UpdatedAtUtc = DateTime.UtcNow;
	await db.SaveChangesAsync();

	return Results.Ok(ToResponse(setting));
});

app.MapDelete("/api/settings/{id:int}", async (int id, SettingsDbContext db) =>
{
	var setting = await db.Settings.FindAsync(id);
	if (setting is null)
	{
		return Results.NotFound();
	}

	db.Settings.Remove(setting);
	await db.SaveChangesAsync();
	return Results.NoContent();
});

await InitializeDatabaseAsync(app);
app.Run();

static bool TryNormalize(SettingInput input, out string groupName, out string key, out string error)
{
	groupName = input.Group.Trim();
	key = input.Key.Trim();
	var value = input.Value ?? string.Empty;
	error = string.Empty;

	if (groupName.Length is 0 or > 80)
	{
		error = "Group is required and must be 80 characters or fewer.";
	}
	else if (key.Length is 0 or > 180)
	{
		error = "Key is required and must be 180 characters or fewer.";
	}
	else if (value.Length > 4000)
	{
		error = "Value must be 4,000 characters or fewer.";
	}

	return error.Length == 0;
}

static SettingResponse ToResponse(AppSetting setting) => new(
	setting.Id,
	setting.GroupName,
	setting.Key,
	setting.IsSecret ? null : setting.Value,
	setting.IsSecret,
	setting.UpdatedAtUtc);

static async Task InitializeDatabaseAsync(WebApplication app)
{
	await using var scope = app.Services.CreateAsyncScope();
	var db = scope.ServiceProvider.GetRequiredService<SettingsDbContext>();
	await db.Database.EnsureCreatedAsync();

	if (await db.Settings.AnyAsync())
	{
		return;
	}

	db.Settings.AddRange(
		new AppSetting { GroupName = "Application", Key = "ProductName", Value = "Northstar Console", UpdatedAtUtc = DateTime.UtcNow },
		new AppSetting { GroupName = "Application", Key = "MaintenanceMode", Value = "false", UpdatedAtUtc = DateTime.UtcNow },
		new AppSetting { GroupName = "Application", Key = "DefaultLocale", Value = "en-US", UpdatedAtUtc = DateTime.UtcNow },
		new AppSetting { GroupName = "Database", Key = "CommandTimeoutSeconds", Value = "30", UpdatedAtUtc = DateTime.UtcNow },
		new AppSetting { GroupName = "Database", Key = "EnableRetry", Value = "true", UpdatedAtUtc = DateTime.UtcNow },
		new AppSetting { GroupName = "Integrations", Key = "WebhookEndpoint", Value = "https://hooks.example.com/events", UpdatedAtUtc = DateTime.UtcNow },
		new AppSetting { GroupName = "Integrations", Key = "WebhookSigningKey", Value = "replace-before-use", IsSecret = true, UpdatedAtUtc = DateTime.UtcNow });

	await db.SaveChangesAsync();
}

internal sealed record SettingResponse(
	int Id,
	string Group,
	string Key,
	string? Value,
	bool IsSecret,
	DateTime UpdatedAtUtc);

internal sealed class SettingInput
{
	public string Group { get; init; } = string.Empty;
	public string Key { get; init; } = string.Empty;
	public string? Value { get; init; } = string.Empty;
	public bool IsSecret { get; init; }
}
