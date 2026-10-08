# KeyLedger

KeyLedger is a self-hosted settings registry built with ASP.NET Core 10 and Entity Framework Core. Settings are organized by group and stored as key/value pairs. The same data model supports SQLite for local use, SQL Server, and Oracle Database.

## Run locally

```powershell
dotnet run --project KeyLedger --urls http://localhost:5090
```

Open <http://localhost:5090>. On first start, the app creates `keyledger.db` and inserts a small sample registry. The database provider and connection string can be changed in `KeyLedger/appsettings.json` or with environment variables.

## Database providers

Set `Database:Provider` to `Sqlite`, `SqlServer`, or `Oracle`, and set `ConnectionStrings:Settings` to the matching connection string. Environment variable equivalents are `Database__Provider` and `ConnectionStrings__Settings`.

SQL Server example:

```powershell
$env:Database__Provider = "SqlServer"
$env:ConnectionStrings__Settings = "Server=localhost;Database=KeyLedger;Trusted_Connection=True;TrustServerCertificate=True"
dotnet run --project KeyLedger
```

Oracle example:

```powershell
$env:Database__Provider = "Oracle"
$env:ConnectionStrings__Settings = "User Id=KEYLEDGER;Password=...;Data Source=localhost:1521/FREEPDB1"
dotnet run --project KeyLedger
```

The configured database user must be allowed to create the `APP_SETTINGS` table and its unique index on first startup. `EnsureCreated` initializes an empty database; use EF Core migrations for controlled schema changes to an existing deployment.

## REST API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Provider and connectivity status |
| `GET` | `/api/groups` | Group names and setting counts |
| `GET` | `/api/settings` | List settings; accepts `group` and `search` query parameters |
| `POST` | `/api/settings` | Create a setting |
| `PUT` | `/api/settings/{id}` | Update a setting |
| `DELETE` | `/api/settings/{id}` | Delete a setting |
| `GET` | `/api/settings/export` | Export grouped settings as JSON; accepts an optional `group` |

The settings list masks protected values. The export endpoint includes their actual values so consuming services can use the exported configuration. For example:

```powershell
Invoke-RestMethod http://localhost:5090/api/settings/export
```

Set `Api__Key` to a long, random value to require the `X-Api-Key` header for every `/api` endpoint. Keep the app bound to localhost for local use. Before exposing it to a network, configure an API key, use HTTPS, and add an identity provider and authorization policy appropriate to your organization. Protected values are masked in the UI and API list, but are not encrypted at rest by the application; use database encryption and access controls for sensitive data.

## Data model

`APP_SETTINGS` contains `ID`, `GROUP_NAME`, `SETTING_KEY`, `SETTING_VALUE`, `IS_SECRET`, and `UPDATED_UTC`. A unique composite index prevents duplicate keys within a group. The model deliberately avoids provider-specific column types so it can be used by SQLite, SQL Server, or Oracle.