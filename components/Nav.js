'use client';
import Link from 'next/link';import {usePathname} from 'next/navigation';
const L=[['/patient','Patient'],['/admin','Hospital staff'],['/dispatch','Control room'],['/platform','Verifier']];
export default function Nav(){const p=usePathname();return<><Link href="/" className="brand"><svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#D93B34"/><path d="M12 6h4v6h6v4h-6v6h-4v-6H6v-4h6z" fill="#fff"/></svg><span>Bed Coordination</span></Link><nav className="nav">{L.map(([h,t])=><Link key={h} href={h} className={p.startsWith(h)?'on':''}>{t}</Link>)}</nav></>}
