Option Explicit

Dim activationCommand, activationExitCode, commandIndex, cwdIndex, fileSystem, index, parameterStart, parameters, runner, shell
parameters = ""

If WScript.Arguments.Count >= 8 Then
  Set fileSystem = CreateObject("Scripting.FileSystemObject")
  If fileSystem.FileExists(WScript.Arguments(0)) Then
    activationCommand = QuoteArgument(WScript.Arguments(0)) & " " & QuoteArgument(WScript.Arguments(1)) & " " & QuoteArgument(WScript.Arguments(2))
    Set runner = CreateObject("WScript.Shell")
    activationExitCode = runner.Run(activationCommand, 0, True)
    If activationExitCode = 0 Then WScript.Quit 0
  End If
  cwdIndex = 3
  commandIndex = 4
  parameterStart = 5
Else
  cwdIndex = 0
  commandIndex = 1
  parameterStart = 2
End If

For index = parameterStart To WScript.Arguments.Count - 1
  If Len(parameters) > 0 Then parameters = parameters & " "
  parameters = parameters & QuoteArgument(WScript.Arguments(index))
Next

Set shell = CreateObject("Shell.Application")
shell.ShellExecute WScript.Arguments(commandIndex), parameters, WScript.Arguments(cwdIndex), "", 0

Function QuoteArgument(value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(92) & Chr(34)) & Chr(34)
End Function
