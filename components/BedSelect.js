import {BED_GROUPS,BED_LABELS} from '@/lib/constants';
export default function BedSelect(p){return<select {...p}>{BED_GROUPS.map(([g,ts])=><optgroup key={g} label={g}>{ts.map(t=><option key={t} value={t}>{BED_LABELS[t]}</option>)}</optgroup>)}</select>}
