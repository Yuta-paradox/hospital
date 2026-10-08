'use client';
import {useEffect,useRef} from 'react';import L from 'leaflet';import 'leaflet/dist/leaflet.css';
export default function MapView({me,hs}){const el=useRef(null);
 useEffect(()=>{const map=L.map(el.current).setView([me.lat,me.lng],12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
  const txt=s=>{const d=document.createElement('div');d.textContent=s;return d};const pts=[[me.lat,me.lng]];
  L.circleMarker([me.lat,me.lng],{radius:9,color:'#0b6bcb',fillOpacity:.9}).addTo(map).bindPopup(txt('You'));
  hs.forEach((h,i)=>{L.circleMarker([h.lat,h.lng],{radius:9,color:i?'#6a7686':'#18864b',fillOpacity:.9}).addTo(map).bindPopup(txt(`${h.name} · ${h.free} free · ${h.eta_min} min`));pts.push([h.lat,h.lng])});
  map.fitBounds(pts,{padding:[30,30]});return()=>map.remove()},[me,hs]);
 return<div ref={el} style={{height:260,borderRadius:12,border:'1px solid var(--b)'}}/>}
