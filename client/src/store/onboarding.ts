import { atom } from 'recoil';

const conversationCountAtom = atom<number | null>({
  key: 'conversationCount',
  default: null,
});

const openImportInstructionsAtom = atom<boolean>({
  key: 'openImportInstructions',
  default: false,
});

export default {
  conversationCountAtom,
  openImportInstructionsAtom,
};
