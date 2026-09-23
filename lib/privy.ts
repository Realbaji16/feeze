/** Public client id. Env overrides this so local and Vercel can use their own app. */
const PUBLISHED_APP_ID = "cmud4bi7w00130cl7p2bosvax";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || PUBLISHED_APP_ID;
