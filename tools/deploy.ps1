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
    & node (Join-Path $PSScriptRoot '..\node_modules\hexo\bin\hexo') $command
    if ($LASTEXITCODE -ne 0) {
        throw "Hexo $command 失败，退出码：$LASTEXITCODE"
    }
}

& git add -A
if ($LASTEXITCODE -ne 0) { throw '无法暂存网站源码' }
& git diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
    & git commit -m 'Update blog content'
    if ($LASTEXITCODE -ne 0) { throw '无法保存网站源码提交' }
}
elseif ($LASTEXITCODE -ne 0) {
    throw '无法检查网站源码状态'
}
& git push origin main
if ($LASTEXITCODE -ne 0) { throw '网页已发布，但网站源码同步到 main 分支失败' }
