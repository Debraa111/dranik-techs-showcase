import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ServiceCard } from "@/components/service-card";
import { useColors } from "@/hooks/use-colors";
import { useLocation } from "@/hooks/use-location";
import { trpc } from "@/lib/trpc";
import { addSearchHistory, clearSearchHistory, getRecentlyViewed, getSearchHistory } from "@/lib/local-store";
import { distanceKm } from "@/lib/geo";

type SortOption = "recommended" | "price_asc" | "price_desc" | "rating" | "popular" | "newest" | "nearest";

const SORT_OPTIONS: { id: SortOption; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "recommended", label: "Recommended", icon: "auto-awesome" },
  { id: "nearest", label: "Nearest", icon: "near-me" },
  { id: "rating", label: "Top rated", icon: "star" },
  { id: "popular", label: "Most booked", icon: "local-fire-department" },
  { id: "newest", label: "Newest", icon: "new-releases" },
  { id: "price_asc", label: "Price: low → high", icon: "arrow-upward" },
  { id: "price_desc", label: "Price: high → low", icon: "arrow-downward" },
];

export default function SearchScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ categoryId?: string; q?: string }>();
  const [query, setQuery] = useState(params.q ?? "");
  const [debounced, setDebounced] = useState(params.q ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(
    params.categoryId ? Number(params.categoryId) : null,
  );
  const [sort, setSort] = useState<SortOption>("recommended");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const location = useLocation();

  useFocusEffect(
    useCallback(() => {
      getRecentlyViewed().then(setRecentIds);
    }, []),
  );

  // Sync category/query from navigation params (e.g. taps from home screen)
  useEffect(() => {
    if (params.categoryId) setCategoryId(Number(params.categoryId));
  }, [params.categoryId]);

  useEffect(() => {
    if (params.q) {
      setQuery(params.q);
      setDebounced(params.q);
    }
  }, [params.q]);

  // Debounce the search text
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Persist executed searches to history
  useEffect(() => {
    if (debounced.trim().length >= 3) {
      addSearchHistory(debounced).then(setHistory);
    }
  }, [debounced]);

  useEffect(() => {
    getSearchHistory().then(setHistory);
  }, []);

  const categoriesQuery = trpc.categories.list.useQuery();
  const servicesQuery = trpc.services.list.useQuery({
    search: debounced.trim() || undefined,
    categoryId: categoryId ?? undefined,
    verifiedOnly: verifiedOnly || undefined,
    limit: 50,
  });
  const recentServicesQuery = trpc.services.list.useQuery({ limit: 50 }, { enabled: recentIds.length > 0 });

  // Live suggestions: match category names + service titles while typing
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || q === debounced.trim().toLowerCase()) return [];
    const cats = (categoriesQuery.data ?? [])
      .filter((c) => c.name.toLowerCase().includes(q))
      .map((c) => ({ type: "category" as const, id: c.id, label: c.name }));
    const svcs = (servicesQuery.data ?? [])
      .filter((r) => r.service.title.toLowerCase().includes(q))
      .slice(0, 4)
      .map((r) => ({ type: "service" as const, id: r.service.id, label: r.service.title }));
    return [...cats.slice(0, 3), ...svcs];
  }, [query, debounced, categoriesQuery.data, servicesQuery.data]);

  const getDistanceKm = useCallback(
    (provider: { latitude: string | null; longitude: string | null } | undefined) => {
      if (!location.coords || !provider?.latitude || !provider?.longitude) return null;
      return distanceKm(
        location.coords.latitude,
        location.coords.longitude,
        parseFloat(provider.latitude),
        parseFloat(provider.longitude),
      );
    },
    [location.coords],
  );

  const results = useMemo(() => {
    const rows = [...(servicesQuery.data ?? [])];
    switch (sort) {
      case "price_asc":
        rows.sort((a, b) => parseFloat(a.service.basePrice) - parseFloat(b.service.basePrice));
        break;
      case "price_desc":
        rows.sort((a, b) => parseFloat(b.service.basePrice) - parseFloat(a.service.basePrice));
        break;
      case "rating":
        rows.sort(
          (a, b) => parseFloat(b.provider?.averageRating ?? "0") - parseFloat(a.provider?.averageRating ?? "0"),
        );
        break;
      case "popular":
        rows.sort((a, b) => (b.bookingCount ?? 0) - (a.bookingCount ?? 0));
        break;
      case "newest":
        rows.sort(
          (a, b) => new Date(b.service.createdAt).getTime() - new Date(a.service.createdAt).getTime(),
        );
        break;
      case "nearest": {
        // Providers with no coordinates, or no fix on the customer's own position yet, sort to the end.
        rows.sort((a, b) => {
          const da = getDistanceKm(a.provider);
          const db = getDistanceKm(b.provider);
          if (da === null && db === null) return 0;
          if (da === null) return 1;
          if (db === null) return -1;
          return da - db;
        });
        break;
      }
      default:
        break;
    }
    return rows;
  }, [servicesQuery.data, sort, getDistanceKm]);

  const recentlyViewed = useMemo(
    () =>
      recentIds
        .map((id) => (recentServicesQuery.data ?? []).find((r) => r.service.id === id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .slice(0, 10),
    [recentIds, recentServicesQuery.data],
  );

  const showHistory = focused && !query.trim() && history.length > 0;
  const showRecentlyViewed = !debounced.trim() && recentlyViewed.length > 0;

  const onClearHistory = useCallback(async () => {
    await clearSearchHistory();
    setHistory([]);
  }, []);

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 12 }}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.foreground }}>Search</Text>

        {/* Search input */}
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.surface, borderColor: focused ? colors.primary : colors.border },
          ]}
        >
          <MaterialIcons name="search" size={20} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search services or providers..."
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (query.trim()) addSearchHistory(query).then(setHistory);
            }}
            style={{ flex: 1, fontSize: 15, color: colors.foreground, paddingVertical: 12 }}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <MaterialIcons name="close" size={18} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Search history */}
        {showHistory && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted }}>Recent searches</Text>
              <TouchableOpacity onPress={onClearHistory}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>Clear</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {history.map((h) => (
                <TouchableOpacity
                  key={h}
                  onPress={() => setQuery(h)}
                  style={[styles.historyChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <MaterialIcons name="history" size={14} color={colors.muted} />
                  <Text style={{ fontSize: 13, color: colors.foreground }}>{h}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Live suggestions */}
        {suggestions.length > 0 && focused && (
          <View
            style={{
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              overflow: "hidden",
            }}
          >
            {suggestions.map((s, i) => (
              <TouchableOpacity
                key={`${s.type}-${s.id}`}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (s.type === "category") {
                    setQuery("");
                    setCategoryId(s.id);
                  } else {
                    router.push({ pathname: "/service/[id]" as any, params: { id: String(s.id) } });
                  }
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <MaterialIcons
                  name={s.type === "category" ? "category" : "search"}
                  size={16}
                  color={colors.muted}
                />
                <Text style={{ fontSize: 14, color: colors.foreground, flex: 1 }} numberOfLines={1}>
                  {s.label}
                </Text>
                <MaterialIcons name="north-west" size={14} color={colors.muted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <TouchableOpacity
            onPress={() => setCategoryId(null)}
            style={[
              styles.filterChip,
              {
                backgroundColor: categoryId === null ? colors.primary : colors.surface,
                borderColor: categoryId === null ? colors.primary : colors.border,
              },
            ]}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: categoryId === null ? "#fff" : colors.foreground }}>
              All
            </Text>
          </TouchableOpacity>
          {(categoriesQuery.data ?? []).map((cat) => {
            const active = cat.id === categoryId;
            return (
              <TouchableOpacity
                key={cat.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setCategoryId(active ? null : cat.id);
                }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: active ? "#fff" : colors.foreground }}>
                  {cat.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Sort options */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setVerifiedOnly((v) => !v);
            }}
            style={[
              styles.sortChip,
              {
                backgroundColor: verifiedOnly ? `${colors.primary}14` : "transparent",
                borderColor: verifiedOnly ? colors.primary : colors.border,
              },
            ]}
          >
            <MaterialIcons name="verified" size={14} color={verifiedOnly ? colors.primary : colors.muted} />
            <Text style={{ fontSize: 12, fontWeight: "700", color: verifiedOnly ? colors.primary : colors.muted }}>
              Verified only
            </Text>
          </TouchableOpacity>
          {SORT_OPTIONS.map((opt) => {
            const active = sort === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSort(opt.id);
                  if (opt.id === "nearest" && !location.coords && location.status !== "loading") {
                    location.request();
                  }
                }}
                style={[
                  styles.sortChip,
                  {
                    backgroundColor: active ? `${colors.primary}14` : "transparent",
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <MaterialIcons name={opt.icon} size={14} color={active ? colors.primary : colors.muted} />
                <Text style={{ fontSize: 12, fontWeight: "700", color: active ? colors.primary : colors.muted }}>
                  {opt.label}
                </Text>
                {opt.id === "nearest" && location.status === "loading" && (
                  <MaterialIcons name="hourglass-empty" size={12} color={colors.muted} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {sort === "nearest" && location.status === "denied" && (
          <Text style={{ fontSize: 11.5, color: colors.muted, paddingHorizontal: 2 }}>
            Location access was denied — enable it in your device settings to sort and see distances.
          </Text>
        )}
      </View>

      {/* Results */}
      {servicesQuery.isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height={100} borderRadius={16} />
          ))}
        </View>
      ) : results.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState
            icon="search-off"
            title="No services found"
            description="Try a different search term or category."
            actionLabel="Clear filters"
            onAction={() => {
              setQuery("");
              setCategoryId(null);
            }}
          />
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(row) => String(row.service.id)}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: 16, marginBottom: 16 }}>
              {showRecentlyViewed && (
                <View style={{ gap: 10, marginHorizontal: -20 }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground, paddingHorizontal: 20 }}>
                    Recently viewed
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}
                  >
                    {recentlyViewed.map((row) => (
                      <ServiceCard
                        key={row.service.id}
                        row={row}
                        colors={colors}
                        width={150}
                        onPress={() => router.push({ pathname: "/service/[id]" as any, params: { id: String(row.service.id) } })}
                      />
                    ))}
                  </ScrollView>
                </View>
              )}
              <Text style={{ fontSize: 13, color: colors.muted }}>
                {results.length} service{results.length === 1 ? "" : "s"} found
              </Text>
            </View>
          }
          renderItem={({ item: row }) => (
            <ServiceCard
              row={row}
              colors={colors}
              distanceKm={getDistanceKm(row.provider)}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/service/[id]" as any, params: { id: String(row.service.id) } });
              }}
            />
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
  },
  historyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  sortChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
});
