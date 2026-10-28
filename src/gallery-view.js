export function showGallery(photos, title, openDialog, body, esc){
 if(!photos.length)return;let index=0;
 openDialog(title,'<div class="galleryView"><img id="galleryImage" alt="'+esc(title)+'"><div><button type="button" id="galleryPrev" class="ownerTab">←</button><span id="galleryCount"></span><button type="button" id="galleryNext" class="ownerTab">→</button></div><a id="galleryFull" target="_blank" rel="noopener">Открыть фото в полном размере ↗</a></div>',true);
 const update=()=>{body.querySelector('#galleryImage').src=photos[index].url;body.querySelector('#galleryFull').href=photos[index].url;body.querySelector('#galleryCount').textContent=(index+1)+' / '+photos.length};
 const move=n=>{index=(index+n+photos.length)%photos.length;update()};body.querySelector('#galleryPrev').onclick=()=>move(-1);body.querySelector('#galleryNext').onclick=()=>move(1);
 body.querySelector('.galleryView').onkeydown=e=>{if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1)};
 let start;const img=body.querySelector('#galleryImage');img.ontouchstart=e=>start=e.changedTouches[0].clientX;img.ontouchend=e=>{const d=e.changedTouches[0].clientX-start;if(Math.abs(d)>40)move(d<0?1:-1)};update();body.querySelector('#galleryNext').focus();
}
