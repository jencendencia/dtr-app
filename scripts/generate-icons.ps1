Add-Type -AssemblyName System.Drawing

$src = (Resolve-Path 'JE_logo.png').Path
$outDir = (Resolve-Path 'build').Path

# Load source image
$img = [System.Drawing.Image]::FromFile($src)
$base = New-Object System.Drawing.Bitmap $img

function New-SizedBitmap([System.Drawing.Bitmap]$source, [int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($source, 0, 0, $size, $size)
    $g.Dispose()
    return $bmp
}

# --- Generate PNG files ---
$png1024 = New-SizedBitmap $base 1024
$png1024.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$png1024.Dispose()
Write-Output "Generated build/icon.png (1024x1024)"

$png256 = New-SizedBitmap $base 256
$png256.Save((Join-Path $outDir 'icon_256.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$png256.Dispose()
Write-Output "Generated build/icon_256.png (256x256)"

# --- Generate multi-resolution ICO file ---
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$bitmaps = @()
foreach ($s in $sizes) {
    $bitmaps += New-SizedBitmap $base $s
}

# Build ICO container
$icoPath = Join-Path $outDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header
$bw.Write([UInt16]0)      # reserved
$bw.Write([UInt16]1)      # type = icon
$bw.Write([UInt16]$bitmaps.Count)  # image count

# ICONDIRENTRY headers
$offset = 6 + (16 * $bitmaps.Count)
$imageData = @()
foreach ($b in $bitmaps) {
    $mem = New-Object System.IO.MemoryStream
    $b.Save($mem, [System.Drawing.Imaging.ImageFormat]::Png)
    $data = $mem.ToArray()
    $imageData += ,$data
    $mem.Dispose()

    $w = $b.Width
    $h = $b.Height
    if ($w -ge 256) { $w = 0; $h = 0 }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)  # palette colors
    $bw.Write([byte]0)  # reserved
    $bw.Write([UInt16]1)  # color planes
    $bw.Write([UInt16]32) # bits per pixel
    $bw.Write([UInt32]$data.Length)
    $bw.Write([UInt32]$offset)
    $offset += $data.Length
}

# Write image data
foreach ($d in $imageData) {
    $bw.Write($d)
}

$bw.Flush()
$bw.Close()
$fs.Close()

foreach ($b in $bitmaps) { $b.Dispose() }
$base.Dispose()
$img.Dispose()

Write-Output "Generated build/icon.ico (multi-size: $($sizes -join ','))"
Write-Output "Done."
