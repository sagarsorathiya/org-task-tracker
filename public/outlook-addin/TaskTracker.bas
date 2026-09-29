Attribute VB_Name = "TaskTracker"
' ============================================================
' Task Tracker — Outlook VBA Macro
' Push calendar appointments to the Task Tracker portal
' ============================================================
'
' SETUP (one-time per user):
'   1. In Outlook press Alt+F11 to open the VBA editor
'   2. In the editor: File > Import File > select this file (TaskTracker.bas)
'   3. Close the editor
'   4. Right-click the Quick Access Toolbar (top-left in Outlook)
'      > Customize Quick Access Toolbar
'      > Choose commands from: Macros
'      > Select "TaskTracker.PushToTaskTracker"
'      > Click Add >> then OK
'   5. A new button appears in the toolbar. Click it while an
'      appointment is open to push it to the Task Tracker.
'
' TOKEN SETUP (one-time per user):
'   - Go to the Task Tracker portal
'   - Click your name/avatar (top-right) > "Outlook Add-in"
'   - Click "Generate Token" and copy the token
'   - The first time you click the toolbar button, you will be
'     prompted to paste this token. It is saved automatically.
' ============================================================

Option Explicit

' ── CONFIGURATION — update API_URL to match your server ─────────────────────
Private Const API_URL As String = "https://tasktracker.example.com/api/integrations/addin/import-event"
Private Const TOKEN_REG_KEY As String = "HKCU\Software\OrgTaskTracker\AddinToken"
' ────────────────────────────────────────────────────────────────────────────

Public Sub PushToTaskTracker()
    Dim oItem As Object

    ' Get the currently open appointment (inspector) or selected item
    If Not Application.ActiveInspector Is Nothing Then
        Set oItem = Application.ActiveInspector.CurrentItem
    ElseIf Application.ActiveExplorer.Selection.Count > 0 Then
        Set oItem = Application.ActiveExplorer.Selection.Item(1)
    End If

    If oItem Is Nothing Then
        MsgBox "No appointment found." & vbCrLf & _
               "Please open or select a calendar appointment first.", _
               vbExclamation, "Task Tracker"
        Exit Sub
    End If

    If oItem.Class <> olAppointment Then
        MsgBox "Please select a calendar appointment (not an email or task).", _
               vbExclamation, "Task Tracker"
        Exit Sub
    End If

    ' Get or prompt for token
    Dim token As String
    token = GetToken()
    If token = "" Then
        token = InputBox( _
            "Enter your Task Tracker add-in token." & vbCrLf & vbCrLf & _
            "Get it from: Task Tracker portal > click your name (top-right) > Outlook Add-in > Generate Token", _
            "Task Tracker — First-time Setup")
        If token = "" Then Exit Sub
        token = Trim(token)
        SaveToken token
        MsgBox "Token saved. You won't need to enter it again.", vbInformation, "Task Tracker"
    End If

    ' Save the appointment first so that any unsaved edits (start/end time, subject)
    ' are committed to the item object before we read them.
    On Error Resume Next
    oItem.Save
    On Error GoTo 0

    ' ── Build JSON payload ───────────────────────────────────────────────────
    Dim itemId As String
    Dim subject As String
    Dim bodyText As String
    Dim startDt As String
    Dim endDt As String

    itemId   = Trim(oItem.EntryID)
    If Len(itemId) = 0 Then itemId = oItem.Subject & "|" & Format(oItem.Start, "yyyy-mm-ddThh:nn:ss")
    itemId   = CleanJson(itemId)
    subject  = oItem.Subject
    If Len(Trim(subject)) = 0 Then subject = "(No Subject)"
    If Len(subject) > 500 Then subject = Left(subject, 497) & "..."
    subject  = CleanJson(subject)

    bodyText = oItem.Body
    If Len(bodyText) > 10000 Then bodyText = Left(bodyText, 10000)
    bodyText = CleanJson(bodyText)

    ' Build ISO 8601 manually to avoid locale-dependent time separators in Format()
    startDt = Format(oItem.Start, "yyyy-mm-dd") & "T" & _
              Format(Hour(oItem.Start),   "00") & ":" & _
              Format(Minute(oItem.Start), "00") & ":" & _
              Format(Second(oItem.Start), "00")
    endDt   = Format(oItem.End, "yyyy-mm-dd") & "T" & _
              Format(Hour(oItem.End),   "00") & ":" & _
              Format(Minute(oItem.End), "00") & ":" & _
              Format(Second(oItem.End), "00")

    Dim reminderSet As Boolean
    Dim reminderMinutes As Long
    reminderSet = oItem.ReminderSet
    reminderMinutes = 0
    If reminderSet Then reminderMinutes = oItem.ReminderMinutesBeforeStart

    Dim json As String
    json = "{" & _
        """outlookItemId"":""" & itemId   & """," & _
        """subject"":"      & """" & subject  & """," & _
        """body"":"         & """" & bodyText & """," & _
        """startDateTime"":"& """" & startDt  & """," & _
        """endDateTime"":"  & """" & endDt    & """," & _
        """isAllDay"":"     & IIf(oItem.AllDayEvent, "true", "false") & "," & _
        """reminderSet"":"  & IIf(reminderSet, "true", "false") & "," & _
        """reminderMinutes"":" & reminderMinutes & _
    "}"

    ' ── POST to API ──────────────────────────────────────────────────────────
    Dim http As Object
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")

    On Error GoTo HttpError
    http.Open "POST", API_URL, False
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "Authorization", "Bearer " & token
    http.SetTimeouts 5000, 10000, 15000, 15000
    http.Send json
    On Error GoTo 0

    Dim httpStatus As Long
    httpStatus = http.Status
    Dim resp As String
    resp = http.ResponseText

    ' ── Handle response ──────────────────────────────────────────────────────
    If httpStatus = 401 Then
        ClearToken
        MsgBox "Your token is invalid or expired." & vbCrLf & _
               "Please run the macro again to enter a new token." & vbCrLf & vbCrLf & _
               "Get a new token: Task Tracker portal > your name > Outlook Add-in", _
               vbExclamation, "Task Tracker — Token Error"
        Exit Sub
    End If

    If InStr(resp, """success"":true") > 0 Then
        Dim taskId As String
        taskId = ExtractJsonValue(resp, "taskId")

        If InStr(resp, """alreadyImported"":true") > 0 Then
            MsgBox "This appointment was already added as Task #" & taskId & ".", _
                   vbInformation, "Task Tracker"
        Else
            MsgBox "Task #" & taskId & " created!" & vbCrLf & _
                   oItem.Subject, _
                   vbInformation, "Task Tracker"
        End If
    Else
        Dim errMsg As String
        errMsg = ExtractJsonValue(resp, "error")
        If errMsg = "" Then errMsg = "HTTP " & httpStatus
        MsgBox "Could not create task: " & errMsg, vbCritical, "Task Tracker"
    End If
    Exit Sub

HttpError:
    MsgBox "Network error — could not reach the Task Tracker server." & vbCrLf & _
           "Error: " & Err.Description & vbCrLf & vbCrLf & _
           "Server: " & API_URL, _
           vbCritical, "Task Tracker"
End Sub

' ── Reset saved token (run this if you need to enter a new token) ────────────
Public Sub ResetTaskTrackerToken()
    ClearToken
    MsgBox "Token cleared. Next time you push an appointment you will be prompted for a new token.", _
           vbInformation, "Task Tracker"
End Sub

' ── Helpers ──────────────────────────────────────────────────────────────────

Private Function GetToken() As String
    On Error Resume Next
    Dim wsh As Object
    Set wsh = CreateObject("WScript.Shell")
    GetToken = wsh.RegRead(TOKEN_REG_KEY)
    If Err.Number <> 0 Then GetToken = ""
    On Error GoTo 0
End Function

Private Sub SaveToken(token As String)
    On Error Resume Next
    Dim wsh As Object
    Set wsh = CreateObject("WScript.Shell")
    wsh.RegWrite TOKEN_REG_KEY, Trim(token), "REG_SZ"
    On Error GoTo 0
End Sub

Private Sub ClearToken()
    On Error Resume Next
    Dim wsh As Object
    Set wsh = CreateObject("WScript.Shell")
    wsh.RegDelete TOKEN_REG_KEY
    On Error GoTo 0
End Sub

Private Function CleanJson(s As String) As String
    s = Replace(s, "\",  "\\")
    s = Replace(s, """", "\""")
    s = Replace(s, Chr(13) & Chr(10), "\n")
    s = Replace(s, Chr(13), "\n")
    s = Replace(s, Chr(10), "\n")
    s = Replace(s, Chr(9),  "\t")
    CleanJson = s
End Function

Private Function ExtractJsonValue(json As String, key As String) As String
    Dim pattern As String
    pattern = """" & key & """:"
    Dim pos As Long
    pos = InStr(json, pattern)
    If pos = 0 Then ExtractJsonValue = "": Exit Function

    Dim startPos As Long
    startPos = pos + Len(pattern)
    Do While Mid(json, startPos, 1) = " "
        startPos = startPos + 1
    Loop

    If Mid(json, startPos, 1) = """" Then
        startPos = startPos + 1
        Dim endPos As Long
        endPos = InStr(startPos, json, """")
        ExtractJsonValue = Mid(json, startPos, endPos - startPos)
    Else
        Dim i As Long
        For i = startPos To Len(json)
            Select Case Mid(json, i, 1)
                Case ",", "}", " ", "]"
                    ExtractJsonValue = Mid(json, startPos, i - startPos)
                    Exit Function
            End Select
        Next i
        ExtractJsonValue = Mid(json, startPos)
    End If
End Function
