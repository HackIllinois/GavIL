# usage: python3 freeze-loading.py in.mp4 out.mp4   (needs numpy and ffmpeg)
# Finds the frames the screencast caught while the app was between two screens and holds the previous screen over
# them (ffmpeg freezeframes). Two kinds:
#   1. the app's "Loading..." card (a thin cream strip on purple) and the one-frame flickers between such frames;
#   2. glitch frames: 1 to 3 frames that show another screen (a flash of a panel that is already closed, a bounce back
#      to the previous tab) between two frames that are the same picture (A, B, A).
# Video only: the audio is copied untouched and the frame count is unchanged, so the narration stays in sync.
# One more thing, also video only: a render can end a few frames before its audio (the last static frame is held a little
# short). If the video stream is shorter than the audio, the last frame is repeated at the end to make them equal; nothing
# before the end moves.
import os, subprocess, sys, tempfile, numpy as np
src, dst = sys.argv[1], sys.argv[2]
W,H=128,80
p=subprocess.Popen(['ffmpeg','-v','error','-i',src,'-vf',f'scale={W}:{H}:flags=area','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
fs=W*H*3; cream=[]; small=[]
while True:
    b=p.stdout.read(fs)
    if len(b)<fs: break
    a=np.frombuffer(b,np.uint8).reshape(H,W,3).astype(np.int16)
    small.append(a)
    body=a[int(H*0.2):]
    cream.append(((body[...,0]>225)&(body[...,1]>215)&(body[...,2]>180)).mean())
c=np.array(cream)
# a Loading card is a thin cream strip on purple (0.116 of the body, or 0.000 when it sits in the header band)
bad=(np.abs(c-0.116)<0.004)|(c<0.002)
n=len(c)
loading=bad.copy()
# close gaps of up to 2 frames between bad frames (one-frame flickers of the old page)
i=0
while i<n:
    if bad[i]:
        j=i
        while j+1<n and bad[j+1]: j+=1
        k=j+1
        while k<n and not bad[k] and k-j<=3: k+=1
        if k<n and bad[k] and k-j<=3: bad[j+1:k]=True
        i=j+1
    else: i+=1
loading=bad.copy()
# glitch frames: frames a..b (at most 3) that all differ clearly from frame a-1, while frame b+1 is the same picture
# as frame a-1 again (mean absolute difference on a 0..255 scale, on the 128x80 copy: a disc moving or a toast fading
# is far below 2; a flash of another screen is 4 or more: a closed panel coming back measures 6 and up, the Table talk
# switch snapping back to On for one frame while it is turned off measured 4.0, so THR is 3)
EPS,THR,MAXRUN=2.0,3.0,3
def dist(x,y): return float(np.abs(small[x]-small[y]).mean())
glitch=np.zeros(n,bool)
a=1
while a<n-1:
    hit=0
    for L in range(1,MAXRUN+1):
        b=a+L-1
        if b+1>=n: break
        if bad[a-1] or bad[b+1]: continue
        if dist(a-1,b+1)<EPS and all(dist(a-1,k)>THR for k in range(a,b+1)):
            hit=L; break
    if hit:
        glitch[a:a+hit]=True; a+=hit
    else: a+=1
bad=bad|glitch
runs=[]
for f in np.where(bad)[0]:
    if runs and f==runs[-1][1]+1: runs[-1][1]=f
    else: runs.append([int(f),int(f)])
kind=lambda r:'loading' if loading[r[0]:r[1]+1].any() else 'glitch'
print('frames',n,'bad runs',[(r[0],r[1],kind(r)) for r in runs])
# how much longer is the audio than the video? (seconds; a frame or less is nothing)
def stream_len(sel):
    o=subprocess.run(['ffprobe','-v','error','-select_streams',sel,'-show_entries','stream=duration','-of','csv=p=0',src],capture_output=True,text=True).stdout.strip()
    try: return float(o)
    except ValueError: return None
vl,al=stream_len('v:0'),stream_len('a:0')
pad=round(al-vl,3) if vl is not None and al is not None and al-vl>1/30 else 0
if pad: print('video is',pad,'s shorter than the audio: the last frame is repeated for that long')
if not runs and not pad:
    subprocess.run(['cp',src,dst]); sys.exit(0)
parts=[]; last='0:v'
for k,(a,b) in enumerate(runs):
    if a==0: raise SystemExit('bad frame at the very start')
    parts.append(f'[{last}]split[s{k}a][s{k}b];[s{k}a][s{k}b]freezeframes=first={a}:last={b}:replace={a-1}[o{k}]')
    last=f'o{k}'
if pad:
    parts.append(f'[{last}]tpad=stop_mode=clone:stop_duration={pad}[padded]')
    last='padded'
flt=';'.join(parts)
fd,script=tempfile.mkstemp(suffix='.filter'); os.write(fd,flt.encode()); os.close(fd)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',src,'-filter_complex_script',script,'-map',f'[{last}]','-map','0:a','-c:v','libx264','-crf','17','-preset','medium','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',dst],check=True)
os.unlink(script)
print('wrote',dst)
