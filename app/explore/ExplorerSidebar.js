"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function Icon({ name, size = 18 }) {
  const common = { width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.7,strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":true };
  const paths = {
    leaf:<><path d="M20.5 3.5C12 3.5 5 6.6 5 13.2c0 3.3 2.3 5.3 5.2 5.3 6.3 0 9.9-7.3 10.3-15Z"/><path d="M3.5 21c3.1-5.1 7.4-8.4 13-11"/></>,
    map:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>,
    droplet:<><path d="M12 2.8S5.5 10.1 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.1 12 2.8 12 2.8Z"/><path d="M9 15.2a3.1 3.1 0 0 0 3 3"/></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    sprout:<><path d="M12 21v-9"/><path d="M12 13C5 13 4 8 4 5c5 0 8 2 8 8Z"/><path d="M12 16c0-6 4-9 8-9 0 4-1.5 9-8 9Z"/></>,
    book:<><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"/><path d="M4 5.5V22M8 7h8M8 11h8"/></>,
    chevron:<path d="m9 18 6-6-6-6"/>, menu:<><path d="M4 6h16M4 12h16M4 18h16"/></>, close:<path d="m6 6 12 12M18 6 6 18"/>, arrow:<path d="M5 12h14m-6-6 6 6-6 6"/>
  };
  return <svg {...common}>{paths[name] || paths.leaf}</svg>;
}
const navigation = [
  ["/explore/map","Global farm map","NEW","map"], ["/explore/vegetation","Field vegetation","LIVE","leaf"],
  ["/explore/land-story","AI Land Storyteller","AI","book"], ["/explore/water-stress","Water stress","LIVE","droplet"],
  ["/explore/bare-field","Bare-field detection","LIVE","sprout"], ["/explore/soil-health","Soil health","LIVE","sprout"],
  ["/explore/rotation","Rotation engine","NEW","sprout"], ["/explore/replay","Climate replay","NEW","calendar"], ["/explore/passport","Evidence passport","NEW","leaf"]
];
function Brand(){return <Link href="/" className="fx-brand fx-brand-light" aria-label="Agrimetry home"><span className="fx-brand-mark"><Icon name="leaf" size={21}/></span><span className="fx-brand-word">agrimetry<span className="fx-brand-dot">.</span></span></Link>}

export default function ExplorerSidebar(){
  const [collapsed,setCollapsed]=useState(true);
  const [mobileOpen,setMobileOpen]=useState(false);
  useEffect(()=>{const onKey=e=>{if(e.key==="Escape")setMobileOpen(false)};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[]);
  return <>
    <button className="fx-sidebar-mobile-trigger" type="button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(true)}><Icon name="menu" size={21}/></button>
    <div className={`fx-sidebar-backdrop ${mobileOpen?"is-visible":""}`} onClick={()=>setMobileOpen(false)} aria-hidden="true"/>
    <aside className={`fx-sidebar ${collapsed?"fx-sidebar-collapsed":""} ${mobileOpen?"fx-sidebar-mobile-open":""}`} aria-label="Main sidebar navigation">
      <Brand/>
      <button type="button" className="fx-sidebar-toggle" onClick={()=>setCollapsed(v=>!v)} aria-label={collapsed?"Expand sidebar":"Collapse sidebar"} aria-expanded={!collapsed}><Icon name="chevron" size={16}/></button>
      <div className="fx-workspace-label">WORKSPACE</div>
      <nav className="fx-nav" aria-label="Application navigation">
        {navigation.map(([href,label,tag,icon])=><Link key={href} href={href} className="fx-nav-map-link" title={collapsed?label:undefined} onClick={()=>setMobileOpen(false)}><Icon name={icon} size={17}/><span>{label}</span><em>{tag}</em></Link>)}
      </nav>
      <div className="fx-sidebar-bottom"><div className="fx-side-earth"><div className="fx-earth-orbit"><span/></div><span>EARTH DATA, MADE USEFUL.</span></div><Link href="/" className="fx-back-home" onClick={()=>setMobileOpen(false)}><Icon name="arrow" size={15}/> Back to Agrimetry</Link><div className="fx-sidebar-version">AGRIMETRY · EARLY ACCESS</div></div>
    </aside>
  </>;
}
