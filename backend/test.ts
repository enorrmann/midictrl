import { getAlsaState } from './src/alsa';

getAlsaState().then(state => {
    console.log(JSON.stringify(state, null, 2));
}).catch(console.error);
