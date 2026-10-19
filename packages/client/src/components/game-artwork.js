/** First-party cover illustrations. Inline vectors stay sharp and work offline. */
import React from 'react';
const h = React.createElement;
const IDS = ['2048', 'snake', 'breakout', 'jump'];
export function hasGameArtwork(id) { return IDS.includes(id); }

export function GameArtwork(props) {
  const id = props.id;
  const rect = (x, y, width, height, fill, rx = 12, more = {}) => h('rect', { x, y, width, height, fill, rx, ...more });
  const circle = (cx, cy, r, fill, more = {}) => h('circle', { cx, cy, r, fill, ...more });
  const path = (d, stroke, width, more = {}) => h('path', { d, fill: 'none', stroke, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', ...more });
  let art;
  if (id === '2048') {
    art = h('g', null,
      rect(0, 0, 640, 400, '#e9e1d4', 0),
      circle(530, 20, 240, '#f1eade'), circle(60, 410, 180, '#d7ccba'),
      h('g', { transform: 'translate(178 62) rotate(-10 142 142)' },
        rect(-10, 6, 300, 280, '#c8baa6', 30),
        rect(0, 0, 280, 280, '#b9a88f', 26),
        ...[[16, 16, '2', '#f6f0e5', '#79684f'], [148, 16, '8', '#f3c578', '#815328'], [16, 148, '16', '#eda05d', '#fff7ed'], [148, 148, '32', '#db7450', '#fff7ed']].map(([x,y,n,bg,fg]) => h('g', { key:n }, rect(x,y,116,116,bg,17), h('text', { x:x+58,y:y+77, fill:fg, textAnchor:'middle', fontFamily:'Georgia, serif', fontSize:63,fontWeight:700 },n)))
      ),
      path('M 506 268 h 50 m -25 -25 v 50', '#ae9b7d', 3),
      circle(112, 102, 5, '#b5a68e'), circle(542, 130, 3, '#b5a68e')
    );
  } else if (id === 'snake') {
    art = h('g', null,
      rect(0,0,640,400,'#163d35',0),circle(570,30,235,'#1d4b40'),circle(35,420,210,'#10342d'),
      ...Array.from({length:9},(_,i)=>path(`M ${88+i*58} 46 v 310`,'#2c5548',1,{key:'v'+i})),
      ...Array.from({length:6},(_,i)=>path(`M 70 ${55+i*58} h 510`,'#2c5548',1,{key:'h'+i})),
      path('M 174 283 H 232 Q 262 283 262 253 V 161 Q 262 128 295 128 H 373 Q 404 128 404 160 V 214 Q 404 244 434 244 H 464','#0c2b25',46,{transform:'translate(0 10)'}),
      path('M 174 283 H 232 Q 262 283 262 253 V 161 Q 262 128 295 128 H 373 Q 404 128 404 160 V 214 Q 404 244 434 244 H 464','#c4df8c',40),
      circle(458,235,3.5,'#19372b'),circle(458,253,3.5,'#19372b'),
      circle(172,126,17,'#eeac74'),path('M 172 107 q 2 -17 15 -17','#d7e3ae',5),
      circle(172,283,7,'#9fbd72')
    );
  } else if (id === 'breakout') {
    art = h('g', null,
      rect(0,0,640,400,'#192b50',0),circle(585,45,210,'#233961'),
      ...Array.from({length:4},(_,r)=>Array.from({length:6},(_,c)=>rect(115+c*70,67+r*39,60,28,['#ee9a83','#f3bb80','#e9d6a8','#8ebdb5'][r],6,{key:r+'-'+c,opacity:r===3&&c===3?0.15:1}))),
      path('M 352 188 L 280 290 L 376 356','#90aacb',2,{strokeDasharray:'6 10',opacity:0.7}),
      circle(309,249,15,'#14233f'),circle(309,243,13,'#fff6de'),
      rect(240,335,150,17,'#8ebdb5',8),rect(251,335,128,5,'#c7e2d9',3),
      circle(71,262,3,'#5b7296'),circle(556,291,4,'#5b7296')
    );
  } else if (id === 'jump') {
    art = h('g', null,
      rect(0,0,640,400,'#282d49',0),circle(518,-10,230,'#343b5e'),circle(86,398,180,'#21283f'),
      ...[[100,70,3],[174,170,2],[466,90,3],[550,245,2],[375,38,2]].map(([x,y,r],i)=>circle(x,y,r,'#939ab6',{key:i})),
      rect(90,326,120,16,'#90b8a1',8),rect(407,218,122,16,'#90b8a1',8),rect(235,110,98,13,'#729686',6),
      path('M 221 312 Q 278 310 297 256','#efc788',3,{strokeDasharray:'6 9'}),
      h('g', {transform:'translate(265 147) rotate(10 48 48)'},
        path('M 46 4 v -19','#b8d6c4',5),circle(46,-21,8,'#f3d18b'),
        rect(0,3,96,94,'#b8d6c4',26),rect(13,20,70,48,'#202e3d',17),
        circle(34,43,7,'#e9f8dc'),circle(63,43,7,'#e9f8dc'),
        path('M 24 99 l -10 13 M 71 99 l 11 13','#f0cd8a',10),
        rect(33,78,30,7,'#729686',3)
      )
    );
  } else return null;
  return h('svg', {className:'dgm-game-artwork',viewBox:'0 0 640 400',fill:'none',preserveAspectRatio:'xMidYMid slice','aria-hidden':'true',focusable:'false'},art);
}
