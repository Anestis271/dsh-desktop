Option Explicit

Dim index, parameters, shell
parameters = ""

For index = 2 To WScript.Arguments.Count - 1
  If Len(parameters) > 0 Then parameters = parameters & " "
  parameters = parameters & QuoteArgument(WScript.Arguments(index))
Next

Set shell = CreateObject("Shell.Application")
shell.ShellExecute WScript.Arguments(1), parameters, WScript.Arguments(0), "", 0

Function QuoteArgument(value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(92) & Chr(34)) & Chr(34)
End Function
