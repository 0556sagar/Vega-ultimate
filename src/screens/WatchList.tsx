import {
  View,
  Text,
  Platform,
  Image,
  Dimensions,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  Share,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import React, {useState, useCallback, useEffect} from 'react'; // 💡 ADDED useEffect
import {useNavigation} from '@react-navigation/native';
import {WatchListStackParamList} from '../App';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import useThemeStore from '../lib/zustand/themeStore';
import useWatchListStore from '../lib/zustand/watchListStore';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {StatusBar} from 'expo-status-bar';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

// ✅ SAFE BASE64 FUNCTIONS (Ensures proper encoding/decoding for URI data)
const safeB64Encode = str => {
  try {
    // Assuming btoa/atob or Buffer polyfills are available in the environment
    // Use Buffer for cross-environment safety if available
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str).toString('base64');
    }
    return btoa(unescape(encodeURIComponent(str)));
  } catch (e) {
    console.error('B64 Encoding failed:', e);
    return '';
  }
};

const safeB64Decode = encodedString => {
  try {
    // Assuming atob or Buffer polyfills are available
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(encodedString, 'base64').toString('utf8');
    }
    return decodeURIComponent(escape(atob(encodedString)));
  } catch (e) {
    console.error('B64 Decoding failed:', e);
    return null;
  }
};

const WatchList = () => {
  const insets = useSafeAreaInsets();
  const {primary} = useThemeStore(state => state);

  const watchList = useWatchListStore(state => state.watchList);
  const addToWatchList = useWatchListStore(state => state.addToWatchList);

  const reversedWatchList = [...watchList].reverse();

  const navigation =
    useNavigation<NativeStackNavigationProp<WatchListStackParamList>>();

  const [selectedItems, setSelectedItems] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [inputLink, setInputLink] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // 🔹 Responsive grid calculation FIX
  const containerPadding = 12;
  const itemSpacing = 10;
  const minItemWidth = 100; // Minimum desired item width

  // 💡 NEW STATE: Store numColumns to trigger FlatList re-render via key prop
  const [numColumns, setNumColumns] = useState(2);
  const [itemWidth, setItemWidth] = useState(minItemWidth);

  // 💡 NEW useEffect: Recalculate column layout on dimensions change
  useEffect(() => {
    const updateLayout = ({window}) => {
      const availableWidth = window.width - containerPadding * 2;
      const calculatedNumColumns = Math.floor(
        (availableWidth + itemSpacing) / (minItemWidth + itemSpacing),
      );
      const calculatedItemWidth =
        (availableWidth - itemSpacing * (calculatedNumColumns - 1)) /
        calculatedNumColumns;

      setNumColumns(calculatedNumColumns > 0 ? calculatedNumColumns : 1);
      setItemWidth(
        calculatedItemWidth > 0 ? calculatedItemWidth : minItemWidth,
      );
    };

    // Set initial value
    updateLayout({window: Dimensions.get('window')});

    // Subscribe to changes (e.g., orientation change)
    const subscription = Dimensions.addEventListener('change', updateLayout);

    // Cleanup function
    return () => subscription.remove();
  }, []); // Empty dependency array means this runs once on mount

  // 🔹 Select / Deselect items (Unchanged)
  const toggleSelect = (item: any) => {
    const originalItem = watchList.find(i => i.link === item.link);
    if (!originalItem) return;

    if (selectedItems.find(i => i.link === originalItem.link)) {
      setSelectedItems(selectedItems.filter(i => i.link !== originalItem.link));
    } else {
      setSelectedItems([...selectedItems, originalItem]);
    }
  };

  // 🔹 Share selected content (Unchanged)
  const handleShare = async () => {
    if (selectedItems.length === 0) {
      Alert.alert('No Selection', 'Please select some content to share.');
      return;
    }

    try {
      const jsonString = JSON.stringify(selectedItems);
      const encoded = safeB64Encode(jsonString);
      const link = `https://Vega-Next.com/share?data=${encoded}`;

      await Share.share({
        message: `🎬 Here’s my WatchList selection!\nPaste this in Vega Next to import:\n\n${link}`,
      });

      setSelectedItems([]);
    } catch (error) {
      console.error('Share Error:', error);
      Alert.alert('Error', 'Failed to generate share link.');
    }
  };

  // 🔹 Import watchlist from shared link (Central logic - Unchanged)
  const importWatchList = useCallback(() => {
    if (typeof addToWatchList !== 'function') {
      Alert.alert('Internal Error', 'WatchList store action is missing.');
      console.error('Zustand Error: addToWatchList is undefined.');
      return;
    }

    if (isImporting) return;

    if (!inputLink.trim() || !inputLink.includes('data=')) {
      Alert.alert('Invalid Link', 'Please paste a complete share link.');
      return;
    }

    setIsImporting(true);

    try {
      const dataParam = inputLink.split('data=')[1];
      if (!dataParam) {
        Alert.alert('Invalid Link', 'The link must contain valid data.');
        setIsImporting(false);
        return;
      }

      const urlDecodedData = decodeURIComponent(dataParam);
      const decoded = safeB64Decode(urlDecodedData);

      if (decoded === null) {
        Alert.alert(
          'Decoding Error',
          'Failed to decode Base64 data from the link.',
        );
        setIsImporting(false);
        return;
      }

      const parsed = JSON.parse(decoded);

      if (Array.isArray(parsed) && parsed.length > 0) {
        let importedCount = 0;
        parsed.forEach(item => {
          if (!watchList.some(existing => existing.link === item.link)) {
            addToWatchList(item);
            importedCount++;
          }
        });

        if (importedCount > 0) {
          Alert.alert(
            '✅ Success',
            `${importedCount} items imported! Check your list.`,
          );
        } else {
          Alert.alert(
            'Info',
            'All items in the link were already on your list.',
          );
        }

        setInputLink('');
        setModalVisible(false);
      } else {
        Alert.alert(
          'Invalid Data',
          'No valid watchlist found in the link data.',
        );
      }
    } catch (error: any) {
      console.error('Import Error:', error.message);
      if (error instanceof SyntaxError) {
        Alert.alert(
          'Decoding Error',
          'Could not parse JSON. The link data might be corrupted or malformed.',
        );
      } else {
        Alert.alert(
          'Error',
          'Could not import watchlist. Check the link format.',
        );
      }
    } finally {
      setIsImporting(false);
    }
  }, [inputLink, isImporting, watchList, addToWatchList]);

  // 🔹 Render each item (Uses the new itemWidth)
  const renderItem = ({item}: {item: any}) => {
    const selected = selectedItems.some(i => i.link === item.link);
    return (
      <TouchableOpacity
        onLongPress={() => toggleSelect(item)}
        onPress={() =>
          selectedItems.length > 0
            ? toggleSelect(item)
            : navigation.navigate('Info', {
                link: item.link,
                provider: item.provider,
                poster: item.poster,
              })
        }
        activeOpacity={0.8}
        style={{
          width: itemWidth, // 💡 Uses calculated itemWidth
          marginBottom: 16,
          borderWidth: selected ? 2 : 0,
          borderColor: selected ? primary : 'transparent',
          borderRadius: 10,
        }}>
        <View className="relative overflow-hidden">
          <Image
            className="rounded-xl"
            resizeMode="cover"
            style={{
              width: itemWidth, // 💡 Uses calculated itemWidth
              height: 155,
              borderRadius: 10,
              opacity: selected ? 0.8 : 1,
            }}
            source={{uri: item.poster}}
          />
          <Text
            className="text-white text-xs truncate text-center mt-1"
            style={{maxWidth: itemWidth}} // 💡 Uses calculated itemWidth
            numberOfLines={1}>
            {item.title}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-black justify-center items-center">
      <StatusBar translucent backgroundColor="transparent" style="light" />

      {/* 🔹 Selection Toolbar (Unchanged) */}
      {selectedItems.length > 0 && (
        <View
          className="absolute top-0 left-0 right-0 flex-row justify-between items-center px-4 py-3"
          style={{
            backgroundColor: '#111',
            elevation: 5,
            zIndex: 20,
            paddingTop: insets.top + (Platform.OS === 'ios' ? 0 : 5),
            paddingBottom: 10,
          }}>
          <TouchableOpacity onPress={() => setSelectedItems([])}>
            <Text style={{color: '#fff', fontWeight: '600'}}>Cancel</Text>
          </TouchableOpacity>

          <Text style={{color: primary, fontWeight: '700'}}>
            {selectedItems.length} Selected
          </Text>

          <TouchableOpacity onPress={handleShare}>
            <MaterialCommunityIcons
              name="share-variant"
              size={24}
              color={primary}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* 🔹 Main Content (Updated FlatList props) */}
      <View
        className="flex-1 w-full px-3"
        style={{
          marginTop: selectedItems.length > 0 ? 0 : insets.top + 10,
        }}>
        <Text
          className="text-2xl text-center font-bold mb-6 mt-2"
          style={{color: primary}}>
          Watchlist
        </Text>

        {watchList.length > 0 ? (
          <FlatList
            // ✅ THE CRITICAL FIX: The key prop forces FlatList rebuild on numColumns change.
            key={numColumns}
            data={reversedWatchList}
            renderItem={renderItem}
            keyExtractor={(item, index) => item.link + index}
            numColumns={numColumns}
            columnWrapperStyle={{
              gap: itemSpacing,
              justifyContent: 'flex-start',
            }}
            contentContainerStyle={{
              paddingBottom: 80,
            }}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <MaterialCommunityIcons
              name="playlist-remove"
              size={80}
              color={primary}
            />
            <Text className="text-white/70 text-base mt-4 text-center">
              Your WatchList is empty
            </Text>
          </View>
        )}

        {/* 🔹 Floating Import Button (Unchanged) */}
        <TouchableOpacity
          onPress={() => setModalVisible(true)}
          style={{
            position: 'absolute',
            bottom: 50 + insets.bottom,
            right: 20,
            backgroundColor: primary,
            borderRadius: 50,
            padding: 16,
            elevation: 5,
          }}>
          <MaterialCommunityIcons name="download" size={28} color="#000" />
        </TouchableOpacity>
      </View>

      {/* 🔹 Import Modal (Unchanged) */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{flex: 1, justifyContent: 'flex-end'}}>
          <Pressable
            className="flex-1 bg-black/60"
            onPress={() => setModalVisible(false)}
          />
          <View
            className="rounded-t-2xl p-5"
            style={{
              backgroundColor: '#1a1a1a',
              paddingBottom: 20 + insets.bottom,
            }}>
            <Text
              className="text-center text-lg font-bold mb-4"
              style={{color: primary}}>
              Import WatchList
            </Text>

            <View className="flex-row items-center mb-4">
              <ScrollView
                horizontal={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{flexGrow: 1}}
                className="flex-1 mr-2">
                <TextInput
                  placeholder="Paste your shared link here..."
                  placeholderTextColor="#999"
                  value={inputLink}
                  onChangeText={setInputLink}
                  style={{
                    color: 'white',
                    borderColor: primary,
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    minWidth: '100%',
                  }}
                  autoFocus={true}
                  keyboardType="url"
                  multiline={false}
                />
              </ScrollView>

              <TouchableOpacity
                onPress={() => setInputLink('')}
                className="p-3 rounded-xl"
                style={{
                  backgroundColor: inputLink.length > 0 ? '#333' : '#222',
                  opacity: inputLink.length > 0 ? 1 : 0.5,
                }}
                disabled={inputLink.length === 0}>
                <MaterialCommunityIcons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <Pressable
              onPress={importWatchList}
              disabled={isImporting || !inputLink.trim()}
              className="rounded-xl py-3"
              style={{
                backgroundColor: primary,
                opacity: isImporting || !inputLink.trim() ? 0.7 : 1,
              }}>
              <Text className="text-center font-bold text-black">
                {isImporting ? 'Importing...' : 'Paste & Import'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setInputLink('');
                setModalVisible(false);
              }}
              className="mt-3 rounded-xl py-3 bg-gray-700">
              <Text className="text-center font-semibold text-white">
                Cancel
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

export default WatchList;
