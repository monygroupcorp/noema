// Lucide icon registry — name → component, so config (nav, idents) can reference by string.
import {
  MessageSquare, SlidersHorizontal, LayoutGrid, Workflow, Sparkles, Footprints,
  CircleUser, KeyRound, Palette, ReceiptText, Map, Settings2, Plus,
  ChevronLeft, ChevronRight, ChevronDown, ArrowUp, ArrowRight, X, Check,
  Eye, EyeOff, VenetianMask, UserRound, Search, RotateCw, ImagePlus,
  Heart, Smile, Star, Wallet, Shuffle, Coins, Laptop, Server, FileText,
  type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  'message-square': MessageSquare,
  'sliders-horizontal': SlidersHorizontal,
  'layout-grid': LayoutGrid,
  'workflow': Workflow,
  'sparkles': Sparkles,
  'footprints': Footprints,
  'circle-user': CircleUser,
  'key-round': KeyRound,
  'palette': Palette,
  'receipt-text': ReceiptText,
  'map': Map,
  'settings-2': Settings2,
  'plus': Plus,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'arrow-up': ArrowUp,
  'arrow-right': ArrowRight,
  'x': X,
  'check': Check,
  'eye': Eye,
  'eye-off': EyeOff,
  'venetian-mask': VenetianMask,
  'user-round': UserRound,
  'search': Search,
  'rotate-cw': RotateCw,
  'image-plus': ImagePlus,
  'heart': Heart,
  'smile': Smile,
  'star': Star,
  'wallet': Wallet,
  'shuffle': Shuffle,
  'coins': Coins,
  'laptop': Laptop,
  'server': Server,
  'file-text': FileText,
};

// lucide-react already renders <svg class="lucide lucide-...">, which our CSS targets.
export function Ic({ name }: { name: string }) {
  const C = ICONS[name];
  return C ? <C /> : null;
}
