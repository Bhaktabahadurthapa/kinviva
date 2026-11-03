import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/instrument-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import React, {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';

// Hold rendering until the bundled fonts are ready so no frame uses a fallback.
export const FontGate: React.FC<{children: React.ReactNode}> = ({children}) => {
	const [handle] = useState(() => delayRender('Loading fonts'));
	useEffect(() => {
		Promise.all([
			document.fonts.load('500 40px "Fraunces Variable"'),
			document.fonts.load('italic 400 40px "Fraunces Variable"'),
			document.fonts.load('500 20px "Instrument Sans Variable"'),
			document.fonts.load('400 20px "IBM Plex Mono"'),
			document.fonts.load('500 20px "IBM Plex Mono"'),
		]).then(() => continueRender(handle));
	}, [handle]);
	return <>{children}</>;
};
