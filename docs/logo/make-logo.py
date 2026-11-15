from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import math
ttc = TTCollection('/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc')
font = next(f for f in ttc.fonts if 'JP' in f['name'].getDebugName(1))
gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
def gb(ch):
    bp = BoundsPen(gs); gs[cmap[ord(ch)]].draw(bp); return bp.bounds
def gp(ch, s, dx, dy):
    sp = SVGPathPen(gs); gs[cmap[ord(ch)]].draw(TransformPen(sp, (s,0,0,-s,dx,dy))); return sp.getCommands()

BLUE='#E0652B'; NAVY='#1E3A5F'
# square canvas 660x660, origin shifted so pin center x=330
ox, oy = 132, 120
def P(x,y): return f'{x-ox:.1f} {y-oy:.1f}'
pin = (f'M{P(462,130)}C{P(603,130)} {P(717,244)} {P(717,385)}'
       f'C{P(717,505)} {P(612,592)} {P(476,706)}Q{P(462,718)} {P(448,706)}'
       f'C{P(312,592)} {P(207,505)} {P(207,385)}C{P(207,244)} {P(321,130)} {P(462,130)}Z')
def ell(cx,cy,rx,ry):
    cx-=ox; cy-=oy
    return f'M{cx-rx:.1f} {cy:.1f}A{rx} {ry} 0 1 0 {cx+rx:.1f} {cy:.1f}A{rx} {ry} 0 1 0 {cx-rx:.1f} {cy:.1f}Z'
ring = ell(462,700,226,66) + ell(462,693,166,39)
# 入
x0,y0,x1,y1 = gb('入'); t = 290; s = t/max(x1-x0,y1-y0)
gw, gh = (x1-x0)*s, (y1-y0)*s
cx, cy = 462-ox, 388-oy
ireru = gp('入', s, cx-gw/2-x0*s, cy+gh/2+y0*s)

def mark(fg, inner, idp, tx=0):
    return (f'<g transform="translate({tx} 0)"><defs><mask id="m{idp}" maskUnits="userSpaceOnUse" x="-10" y="-10" width="700" height="700">'
            f'<rect x="-10" y="-10" width="700" height="700" fill="#fff"/><path d="{pin}" fill="#000" stroke="#000" stroke-width="34" stroke-linejoin="round"/></mask></defs>'
            f'<path d="{ring}" fill="{fg}" fill-rule="evenodd" mask="url(#m{idp})"/><path d="{pin}" fill="{fg}"/><path d="{ireru}" fill="{inner}"/></g>')
def svg(w,h,body,bg=None,px=4):
    b = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w//px*4//4}" height="{h//px*4//4}">{b}{body}</svg>\n'

open('logo-mark.svg','w').write(svg(660,660,mark(BLUE,'#fff','a')))
open('logo-mark-white.svg','w').write(svg(660,660,'<g transform="translate(79 79) scale(0.76)">'+mark('#fff',BLUE,'b')+'</g>',bg=NAVY))
open('app-icon.svg','w').write(svg(660,660,'<g transform="translate(79 79) scale(0.76)">'+mark(BLUE,'#fff','f')+'</g>',bg='#fff'))
open('logo-mark-white-transparent.svg','w').write(svg(660,660,mark('#fff',BLUE,'c')))

# horizontal: mark trimmed (x 60..600 visible) then text
fs = 300; sc = fs/upm; x = 640; base = 330 + fs*0.36; parts=[]
for ch in 'じもと入札':
    parts.append(gp(ch, sc, x, base)); x += gs[cmap[ord(ch)]].width*sc*0.96
W = math.ceil(x+30)
word = f'<path d="{" ".join(parts)}" fill="{NAVY}"/>'
open('logo-horizontal.svg','w').write(svg(W,660,mark(BLUE,'#fff','d')+word))
open('logo-horizontal-white.svg','w').write(svg(W,660,mark('#fff',BLUE,'e')+word.replace(NAVY,'#fff'),bg=NAVY))
print(W)
