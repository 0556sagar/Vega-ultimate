import { create } from 'zustand';
import { watchListStorage, WatchListItem } from '../storage';

export type WatchList = WatchListItem;

interface WatchListStore {
  watchList: WatchList[];
  removeItem: (link: string) => void;
  addToWatchList: (item: WatchList) => void;
  addItem: (item: WatchList) => void; // alias
}

const useWatchListStore = create<WatchListStore>()((set, get) => ({
  // 🟢 Initialize state from persistent storage
  watchList: watchListStorage.getWatchList() || [],

  // 🧹 Remove item from both storage + Zustand state
  removeItem: (link: string) => {
    const updated = watchListStorage.removeFromWatchList(link);
    set({ watchList: [...updated] }); // force new array for React re-render
  },

  // 🪄 Add new item — works from app or external link both
  addToWatchList: (item: WatchList) => {
    // Get the current persisted list
    const current = watchListStorage.getWatchList() || [];

    // Filter duplicates by link
    const filtered = current.filter(i => i.link !== item.link);

    // Prepend new item
    const newList = [item, ...filtered];

    // Save updated list to storage (ensure persistence)
    if (typeof watchListStorage.setWatchList === 'function') {
      watchListStorage.setWatchList(newList);
    } else if (typeof watchListStorage.addToWatchList === 'function') {
      watchListStorage.addToWatchList(item);
    }

    // Update Zustand state with a **new array reference**
    // This ensures re-rendering, fixing "video not updating/playing" issue
    set({ watchList: [...newList] });
  },

  // 🔁 Alias: Keeps backward compatibility for older calls using addItem()
  addItem: (item: WatchList) => get().addToWatchList(item),
}));

export default useWatchListStore;
