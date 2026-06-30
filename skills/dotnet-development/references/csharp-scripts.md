# File-Based C# Apps (Quick Scripts)

For C# experiments, prototypes, and small utilities without scaffolding a
project. Requires .NET 10+ (`dotnet --version` first; `#:include`/
`#:exclude` need SDK 10.0.300+). Place files **outside** any directory
containing a `.csproj` — file-based apps inherit `global.json`,
`Directory.Build.props`, and `nuget.config` from parent directories.

```csharp
// hello.cs — top-level statements, no Main/class/namespace boilerplate
Console.WriteLine("Hello from a file-based app!");
var numbers = new[] { 1, 2, 3, 4, 5 };
Console.WriteLine($"Sum: {numbers.Sum()}");
```

```bash
dotnet hello.cs                    # build + run (cached, fast reruns)
dotnet hello.cs -- arg1 "arg 2"    # pass arguments
dotnet clean hello.cs              # clear cached artefacts when done
```

## Directives

All `#:` directives go at the top of the file (after optional shebang),
before `using` directives and code.

```csharp
#:package Humanizer@2.14.1                  // NuGet — always pin a version (@* for latest)
#:property NoWarn=CS0162                    // any MSBuild property, Name=Value, no spaces
#:property PublishAot=false                 // AOT is ON by default — see JSON note below
#:sdk Microsoft.NET.Sdk.Web                 // override default SDK
#:project ../MyLibrary/MyLibrary.csproj     // reference a real project
#:include Helpers.cs                        // compile helper files into the same app
#:include Models/*.cs
#:exclude Models/Generated/*.cs
```

Multi-file layout: top-level statements only in the entry-point file; type
declarations in included files (or below the statements). Keep `#:package`
/ `#:property` directives unique across entry + included files —
duplicates can fail the build.

## AOT and JSON — the pitfall that bites

File-based apps enable **native AOT by default**, so reflection-based
`JsonSerializer.Serialize<T>(value)` fails at runtime. Either use
source-generated JSON:

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

var person = new Person("Alice", 30);
var json = JsonSerializer.Serialize(person, AppJsonContext.Default.Person);

record Person(string Name, int Age);

[JsonSerializable(typeof(Person))]
partial class AppJsonContext : JsonSerializerContext;
```

…or set `#:property PublishAot=false` for a quick script.

## Lifecycle

- Unix: shebang `#!/usr/bin/env dotnet` + `chmod +x` makes it directly
  executable (LF line endings, no BOM).
- Outgrown the format? `dotnet project convert hello.cs` produces a real
  project.
- **.NET 9 or earlier**: file-based apps unavailable — fall back to a
  temporary console project (`dotnet new console -o /tmp/scratch`),
  replace `Program.cs`, `dotnet run`, delete afterwards.
- Clean up script files and cached artefacts when the task is done.
