$ErrorActionPreference = 'Stop'

try {
    $settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
        $proxyAddress = [string]$settings.ProxyServer
        if ($proxyAddress -match '(^|;)https=([^;]+)') {
            $proxyAddress = $Matches[2]
        }
        elseif ($proxyAddress -match '(^|;)http=([^;]+)') {
            $proxyAddress = $Matches[2]
        }
        if ($proxyAddress -notmatch '^https?://') {
            $proxyAddress = "http://$proxyAddress"
        }
        $env:HTTPS_PROXY = $proxyAddress
        $env:HTTP_PROXY = $proxyAddress
    }
}
catch {
    Write-Warning "无法读取 Windows 代理设置，将使用当前网络设置：$($_.Exception.Message)"
}

$env:GIT_CONFIG_COUNT = '2'
$env:GIT_CONFIG_KEY_0 = 'http.version'
$env:GIT_CONFIG_VALUE_0 = 'HTTP/1.1'
$env:GIT_CONFIG_KEY_1 = 'http.sslBackend'
$env:GIT_CONFIG_VALUE_1 = 'schannel'

foreach ($command in @('clean', 'generate', 'deploy')) {
    & npx.cmd hexo $command
    if ($LASTEXITCODE -ne 0) {
        throw "Hexo $command 失败，退出码：$LASTEXITCODE"
    }
}
