import './globals.css';import {Atkinson_Hyperlegible} from 'next/font/google';import Nav from '@/components/Nav';
// Atkinson Hyperlegible: designed for maximum character recognition, suited to stressed readers on small screens
const font=Atkinson_Hyperlegible({weight:['400','700'],subsets:['latin'],display:'swap'});
export const metadata={title:'Emergency Bed Coordination',description:'Real-time emergency bed availability and referral coordination'};
export default function L({children}){return<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/></head><body className={font.className}><header className="appbar"><Nav/></header>{children}</body></html>}
