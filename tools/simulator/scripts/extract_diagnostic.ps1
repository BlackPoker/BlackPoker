[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$raw = [System.IO.File]::ReadAllText("C:\Users\black\.gemini\antigravity\brain\5332ea32-14ff-4b0b-8c62-1b4b0c7c66aa\scratch\matched_line.json", [System.Text.Encoding]::UTF8)
$obj = $raw | ConvertFrom-Json
Write-Host "Object type: $($obj.type)"
Write-Host "Object source: $($obj.source)"
$content = $obj.content
# If content has json code block, extract it
if ($content -match '```json\s*([\s\S]*?)\s*```') {
    $jsonText = $matches[1]
    [System.IO.File]::WriteAllText("C:\Users\black\git\github\BlackPoker-issue551\tools\simulator\.artifacts\user_diagnostic_extracted.json", $jsonText, [System.Text.Encoding]::UTF8)
    Write-Host "Extracted JSON from markdown block to .artifacts\user_diagnostic_extracted.json (Length: $($jsonText.Length))"
} else {
    [System.IO.File]::WriteAllText("C:\Users\black\git\github\BlackPoker-issue551\tools\simulator\.artifacts\user_raw_content.txt", $content, [System.Text.Encoding]::UTF8)
    Write-Host "Saved raw content to .artifacts\user_raw_content.txt (Length: $($content.Length))"
}
