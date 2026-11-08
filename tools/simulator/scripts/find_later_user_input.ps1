[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$reader = [System.IO.File]::OpenText("C:\Users\black\.gemini\antigravity\brain\5332ea32-14ff-4b0b-8c62-1b4b0c7c66aa\.system_generated\logs\transcript.jsonl")
try {
    $lineNum = 0
    while (($line = $reader.ReadLine()) -ne $null) {
        $lineNum++
        if ($lineNum -gt 105185) {
            if ($line.Contains("BP-SIM-AI-GEN8-HUMAN-DEFEAT-REPLAY-R2") -or $line.Contains("4127992094") -or $line.Contains("blackpoker-playtest-diagnostic")) {
                Write-Host "Found match at line $lineNum"
                $obj = $line | ConvertFrom-Json
                if ($obj.type -eq "USER_INPUT") {
                    Write-Host "Found USER_INPUT at line $lineNum"
                    [System.IO.File]::WriteAllText("C:\Users\black\git\github\BlackPoker-issue551\tools\simulator\.artifacts\user_input_$lineNum.txt", $obj.content, [System.Text.Encoding]::UTF8)
                }
            }
        }
    }
} finally {
    $reader.Close()
}
