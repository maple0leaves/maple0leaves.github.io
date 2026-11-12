Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = files.GetParentFolderName(WScript.ScriptFullName)
shell.Run "node editor\server.js", 0, False
WScript.Sleep 1800
shell.Run "http://127.0.0.1:4173/", 1, False
