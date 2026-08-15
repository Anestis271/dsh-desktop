Option Explicit

Dim activationCommand, activationExitCode, fileSystem, index, parameters, runner, shell
parameters = ""

Set fileSystem = CreateObject("Scripting.FileSystemObject")
If fileSystem.FileExists(WScript.Arguments(0)) Then
  activationCommand = QuoteArgument(WScript.Arguments(0)) & " " & QuoteArgument(WScript.Arguments(1)) & " " & QuoteArgument(WScript.Arguments(2))
  Set runner = CreateObject("WScript.Shell")
  activationExitCode = runner.Run(activationCommand, 0, True)
  If activationExitCode = 0 Then WScript.Quit 0
End If

For index = 5 To WScript.Arguments.Count - 1
  If Len(parameters) > 0 Then parameters = parameters & " "
  parameters = parameters & QuoteArgument(WScript.Arguments(index))
Next

Set shell = CreateObject("Shell.Application")
shell.ShellExecute WScript.Arguments(4), parameters, WScript.Arguments(3), "", 0

Function QuoteArgument(value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(92) & Chr(34)) & Chr(34)
End Function
