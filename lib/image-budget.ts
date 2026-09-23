/** keyvalue.immanuel.co stores the value in the URL. About 120 characters works, 250 fails, and a colon fails at any length. Image bytes are hex chunks of 100. A real 16px JPEG is already about 800 bytes, so the old 400-byte cap never saved a picture. */
export const IMAGE_CHUNK_CHARS = 100;
export const IMAGE_MAX_BYTES = 2048;
export const IMAGE_TARGET_BYTES = 1700;
