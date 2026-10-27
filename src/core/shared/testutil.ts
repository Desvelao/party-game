import { generateRoomCode } from '../server/rooms/codes';

export const generateRoomCodeForTest = () => generateRoomCode(() => false);
