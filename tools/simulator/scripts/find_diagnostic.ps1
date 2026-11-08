[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$reader = [System.IO.File]::OpenText("C:\Users\black\.gemini\antigravity\brain\5332ea32-14ff-4b0b-8c62-1b4b0c7c66aa\.system_generated\logs\transcript.jsonl")
try {
    $lineNum = 0
    while (($line = $reader.ReadLine()) -ne $null) {
        $lineNum++
        if ($line.Contains("4127992094") -and ($line.Contains("diagnostic") -or $line.Contains("decisionTranscript"))) {
            Write-Host "Found match at line $lineNum"
            [System.IO.File]::WriteAllText("C:\Users\black\.gemini\antigravity\brain\5332ea32-14ff-4b0b-8c62-1b4b0c7c66aa\scratch\matched_line.json", $line, [System.Text.Encoding]::UTF8)
            break
        }
    }
} finally {
    $reader.Close()
}
