' Starts QuantBot from the desktop shortcut without a console window.
' The launcher (launcher\launch.js) shows the loading screen, installs updates and opens the app window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node"
sh.CurrentDirectory = appDir
sh.Run """" & node & """ """ & appDir & "\launcher\launch.js""", 0, False
