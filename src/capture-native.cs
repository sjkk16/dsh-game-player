using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public sealed class FrameFingerprint {
    public double[] samples; public double score, variance;
}
/** Same 64x36 round-to-even sampling as the original PowerShell implementation. */
public static class GamePlayerCapture {
    static readonly ImageCodecInfo jpeg = FindJpeg();
    static ImageCodecInfo FindJpeg() { foreach(var codec in ImageCodecInfo.GetImageEncoders()) if(codec.MimeType == "image/jpeg") return codec; throw new InvalidOperationException("JPEG encoder unavailable."); }
    public static ImageCodecInfo Jpeg { get { return jpeg; } }
    public static FrameFingerprint Fingerprint(Bitmap bitmap, double[] previous) {
        const int w=64,h=36; var current=new double[w*h]; BitmapData data=null;
        try {
            if(bitmap.PixelFormat==PixelFormat.Format32bppArgb) data=bitmap.LockBits(new Rectangle(0,0,bitmap.Width,bitmap.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
            for(int y=0;y<h;y++) for(int x=0;x<w;x++) {
                int sx=Math.Min(bitmap.Width-1,Convert.ToInt32((double)x*bitmap.Width/w)),sy=Math.Min(bitmap.Height-1,Convert.ToInt32((double)y*bitmap.Height/h));
                double r,g,b;
                if(data!=null) { var p=IntPtr.Add(data.Scan0,sy*data.Stride+sx*4); b=Marshal.ReadByte(p);g=Marshal.ReadByte(p,1);r=Marshal.ReadByte(p,2); }
                else {var c=bitmap.GetPixel(sx,sy);r=c.R;g=c.G;b=c.B;}
                current[y*w+x]=r*.299+g*.587+b*.114;
            }
        } finally {if(data!=null) bitmap.UnlockBits(data);}
        double mean=0,variance=0,total=0; foreach(double v in current)mean+=v; mean/=current.Length;
        for(int i=0;i<current.Length;i++){double d=current[i]-mean;variance+=d*d;if(previous!=null&&previous.Length==current.Length)total+=Math.Abs(current[i]-previous[i]);}
        return new FrameFingerprint {samples=current,score=previous==null||previous.Length!=current.Length?-1:Math.Round(total/(current.Length*255.0),4),variance=Math.Round(variance/current.Length,2)};
    }
}
