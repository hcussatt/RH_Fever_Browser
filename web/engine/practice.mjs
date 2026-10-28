// Whether games skip their practice (game select's "Skip practice" switch, kept in this browser).
// Off by default: a game with a practice plays it before the song, as the original does.
const KEY='rhf-skip-practice';
export function skipPractice(){try{return localStorage.getItem(KEY)==='1';}catch{return false;}}
export function setSkipPractice(on){try{if(on)localStorage.setItem(KEY,'1');else localStorage.removeItem(KEY);}catch{}}
