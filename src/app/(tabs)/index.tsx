import { useEffect, useRef, useState } from "react";
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { ScreenContainer } from "@/components/screen-container";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/pressable-scale";
import { ServiceCard } from "@/components/service-card";
import { ProviderCard } from "@/components/provider-card";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useThemeMode } from "@/lib/theme-provider";
import { trpc } from "@/lib/trpc";
import { distanceKm } from "@/lib/geo";

type ColorPalette = ReturnType<typeof useColors>;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const initials = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return initials.toUpperCase();
}

/** Home stays clean regardless of how many categories exist — "See all" (→ /categories)
 *  is the real full list. Order comes from categories.sortOrder, already admin-editable
 *  from the Categories admin page. */
const HOME_CATEGORIES_LIMIT = 4;

/* ------------------------------- Sub-components ---------------------------- */

function SectionHeader({
  title,
  colors,
  onSeeAll,
}: {
  title: string;
  colors: ColorPalette;
  onSeeAll?: () => void;
}) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>{title}</Text>
      {onSeeAll && (
        <TouchableOpacity onPress={onSeeAll} hitSlop={8}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary }}>See all</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function SectionError({ colors, onRetry }: { colors: ColorPalette; onRetry: () => void }) {
  return (
    <View style={{ paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <MaterialIcons name="error-outline" size={16} color={colors.error} />
      <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }}>Couldn&apos;t load this section.</Text>
      <TouchableOpacity onPress={onRetry} hitSlop={8}>
        <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.primary }}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

function HorizontalSkeletons() {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} width={150} height={150} borderRadius={18} />
      ))}
    </ScrollView>
  );
}

type Banner = {
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  ctaLabel: string;
  onPress: () => void;
};

/** Shows exactly one banner at a time; auto-advances every 5s, supports manual swipe. */
function HeroCarousel({ banners, colors }: { banners: Banner[]; colors: ColorPalette }) {
  const { width } = useWindowDimensions();
  const slideWidth = width - 40;
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = (indexRef.current + 1) % banners.length;
      scrollRef.current?.scrollTo({ x: next * slideWidth, animated: true });
    }, 5000);
    return () => clearInterval(timer);
  }, [banners.length, slideWidth]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / slideWidth);
    indexRef.current = i;
    setIndex(i);
  };

  return (
    <View style={{ gap: 10 }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={slideWidth}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        contentContainerStyle={{ paddingHorizontal: 20 }}
      >
        {banners.map((b, i) => (
          <LinearGradient
            key={i}
            colors={[colors.primary, "#0A2E73"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.banner, { width: slideWidth }]}
          >
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: "#fff", fontSize: 15.5, fontWeight: "800" }}>{b.title}</Text>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}>{b.subtitle}</Text>
              <TouchableOpacity
                onPress={b.onPress}
                style={{ backgroundColor: "rgba(255,255,255,0.18)", alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 }}
                accessibilityRole="button"
                accessibilityLabel={b.ctaLabel}
              >
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{b.ctaLabel}</Text>
              </TouchableOpacity>
            </View>
            <MaterialIcons name={b.icon} size={40} color="rgba(255,255,255,0.35)" />
          </LinearGradient>
        ))}
      </ScrollView>
      {banners.length > 1 && (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 5 }}>
          {banners.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === index ? colors.primary : colors.border, width: i === index ? 16 : 6 },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function AddressPickerModal({
  visible,
  onClose,
  addresses,
  onSelect,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  addresses: any[];
  onSelect: (addr: any) => void;
  colors: ColorPalette;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <View style={styles.modalHandle} />
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground, marginBottom: 12 }}>
            Choose location
          </Text>
          {addresses.length === 0 ? (
            <View style={{ alignItems: "center", gap: 10, paddingVertical: 20 }}>
              <MaterialIcons name="location-off" size={32} color={colors.muted} />
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>
                You haven&apos;t saved any addresses yet.
              </Text>
              <Button
                title="Add an address"
                variant="tinted"
                onPress={() => {
                  onClose();
                  router.push("/addresses" as any);
                }}
              />
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {addresses.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => onSelect(a)}
                  style={[styles.addressRow, { borderColor: colors.border }]}
                  accessibilityRole="button"
                >
                  <MaterialIcons name="location-on" size={18} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{a.label}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
                      {a.addressLine1}, {a.city}, {a.state}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => { onClose(); router.push("/addresses" as any); }} style={{ paddingVertical: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary, textAlign: "center" }}>
                  Manage addresses
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/* ---------------------------------- Home ----------------------------------- */

export default function HomeScreen() {
  const colors = useColors();
  const { user, isAuthenticated } = useAuth();
  const { resolvedScheme, setMode } = useThemeMode();

  const toggleTheme = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMode(resolvedScheme === "dark" ? "light" : "dark");
  };
  const location = useLocation();
  const utils = trpc.useUtils();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const addressesQuery = trpc.addresses.list.useQuery(undefined, { enabled: isAuthenticated });
  const categoriesQuery = trpc.categories.list.useQuery();
  const trendingQuery = trpc.services.trending.useQuery({ limit: 6 });
  const featuredQuery = trpc.providers.featured.useQuery({ limit: 6 });
  const recommendedQuery = trpc.services.recommended.useQuery({ limit: 6 }, { enabled: isAuthenticated });
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });
  const unreadNotifications = (notificationsQuery.data ?? []).filter((n) => !n.isRead).length;

  useEffect(() => {
    if (!selectedAddress && addressesQuery.data && addressesQuery.data.length > 0) {
      setSelectedAddress(addressesQuery.data.find((a) => a.isDefault) ?? addressesQuery.data[0]);
    }
  }, [addressesQuery.data, selectedAddress]);

  const locationLabel = selectedAddress ? `${selectedAddress.city}, ${selectedAddress.state}` : "Asaba, Delta State";

  // Guests (and anyone with no booking history yet) fall back to trending —
  // still real data, just not personalized, rather than showing nothing.
  const recommended = isAuthenticated ? recommendedQuery.data : trendingQuery.data;
  const recommendedLoading = isAuthenticated ? recommendedQuery.isLoading : trendingQuery.isLoading;
  const recommendedError = isAuthenticated ? recommendedQuery.isError : trendingQuery.isError;
  const retryRecommended = () => (isAuthenticated ? recommendedQuery.refetch() : trendingQuery.refetch());

  const banners: Banner[] = [
    {
      title: "Verified professionals, every time",
      subtitle: "Every provider on D'RANIK is vetted and rated by real customers.",
      icon: "verified-user",
      ctaLabel: "Explore",
      onPress: () => router.push("/(tabs)/search" as any),
    },
    {
      title: "Book trusted experts in minutes",
      subtitle: "From electricians to makeup artists — find the right pro, fast.",
      icon: "bolt",
      ctaLabel: "Book Now",
      onPress: () => router.push("/(tabs)/search" as any),
    },
    {
      title: "New to D'RANIK Techs?",
      subtitle: "Browse categories to see everything you can book near you.",
      icon: "explore",
      ctaLabel: "Get started",
      onPress: () => router.push("/(tabs)/search" as any),
    },
  ];

  const goToService = (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/service/[id]" as any, params: { id: String(id) } });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      utils.addresses.list.invalidate(),
      utils.categories.list.invalidate(),
      utils.services.trending.invalidate(),
      utils.providers.featured.invalidate(),
      utils.services.recommended.invalidate(),
    ]);
    setRefreshing(false);
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32, gap: 26 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* 1. Personalized greeting */}
        <Animated.View entering={FadeInDown.duration(350)} style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }} numberOfLines={1}>
              {getGreeting()}
              {user?.name ? `, ${user.name.split(" ")[0]}` : ""} 👋
            </Text>
            <TouchableOpacity
              onPress={() => setPickerOpen(true)}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Current location: ${locationLabel}. Tap to change.`}
            >
              <MaterialIcons name="location-on" size={14} color={colors.muted} />
              <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>
                {locationLabel}
              </Text>
              <MaterialIcons name="keyboard-arrow-down" size={15} color={colors.muted} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={toggleTheme}
            accessibilityRole="button"
            accessibilityLabel={resolvedScheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            style={[styles.bellBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name={resolvedScheme === "dark" ? "light-mode" : "dark-mode"} size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/notifications" as any)}
            accessibilityRole="button"
            accessibilityLabel={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : "Notifications"}
            style={[styles.bellBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name="notifications-none" size={20} color={colors.foreground} />
            {unreadNotifications > 0 && (
              <View style={[styles.bellBadge, { backgroundColor: colors.error, borderColor: colors.background }]}>
                <Text style={styles.bellBadgeText}>{unreadNotifications > 9 ? "9+" : unreadNotifications}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/profile" as any)}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
          >
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.headerAvatar} transition={200} />
            ) : (
              <View style={[styles.headerAvatar, styles.imageFallback, { backgroundColor: `${colors.primary}18` }]}>
                <Text style={{ fontSize: 14, fontWeight: "800", color: colors.primary }}>{getInitials(user?.name)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* 2. Search bar */}
        <Animated.View entering={FadeInDown.delay(50).duration(350)} style={{ paddingHorizontal: 20 }}>
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/search" as any)}
            style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityRole="search"
            accessibilityLabel="Search for a service or provider"
          >
            <MaterialIcons name="search" size={20} color={colors.muted} />
            <Text style={{ fontSize: 14, color: colors.muted, flex: 1 }}>What service do you need today?</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* 3. Service categories: clean grid */}
        <Animated.View entering={FadeInUp.delay(90).duration(350)} style={{ gap: 12 }}>
          <SectionHeader title="Categories" colors={colors} onSeeAll={() => router.push("/categories" as any)} />
          {categoriesQuery.isLoading ? (
            <View style={{ paddingHorizontal: 20, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} width="47%" height={84} borderRadius={16} />
              ))}
            </View>
          ) : categoriesQuery.isError ? (
            <SectionError colors={colors} onRetry={() => categoriesQuery.refetch()} />
          ) : (
            <View style={{ paddingHorizontal: 20, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {(categoriesQuery.data ?? []).slice(0, HOME_CATEGORIES_LIMIT).map((cat) => (
                <PressableScale
                  key={cat.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push({ pathname: "/category/[id]" as any, params: { id: String(cat.id) } });
                  }}
                  style={[styles.categoryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={[styles.categoryIcon, { backgroundColor: `${colors.primary}14` }]}>
                    <MaterialIcons name={(cat.icon as any) || "category"} size={22} color={colors.primary} />
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                    {cat.name}
                  </Text>
                </PressableScale>
              ))}
            </View>
          )}
        </Animated.View>

        {/* 4. Promotional banner */}
        <Animated.View entering={FadeInUp.delay(130).duration(350)}>
          <HeroCarousel banners={banners} colors={colors} />
        </Animated.View>

        {/* 5. Recommended services */}
        <Animated.View entering={FadeInUp.delay(170).duration(350)} style={{ gap: 12 }}>
          <SectionHeader title="Recommended for you" colors={colors} onSeeAll={() => router.push("/(tabs)/search" as any)} />
          {recommendedLoading ? (
            <HorizontalSkeletons />
          ) : recommendedError ? (
            <SectionError colors={colors} onRetry={retryRecommended} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}>
              {(recommended ?? []).map((row) => (
                <ServiceCard key={row.service.id} row={row} colors={colors} width={150} onPress={() => goToService(row.service.id)} />
              ))}
            </ScrollView>
          )}
        </Animated.View>

        {/* 6. Featured professionals */}
        <Animated.View entering={FadeInUp.delay(210).duration(350)} style={{ gap: 12 }}>
          <SectionHeader title="Featured professionals" colors={colors} onSeeAll={() => router.push("/professionals" as any)} />
          {featuredQuery.isLoading ? (
            <HorizontalSkeletons />
          ) : featuredQuery.isError ? (
            <SectionError colors={colors} onRetry={() => featuredQuery.refetch()} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}>
              {(featuredQuery.data ?? []).map((row) => (
                <ProviderCard
                  key={row.provider.id}
                  provider={row.provider}
                  avatarUrl={row.avatarUrl}
                  minPrice={row.minPrice}
                  profession={row.profession}
                  distanceKm={
                    location.coords && row.provider.latitude && row.provider.longitude
                      ? distanceKm(
                          location.coords.latitude,
                          location.coords.longitude,
                          parseFloat(row.provider.latitude),
                          parseFloat(row.provider.longitude),
                        )
                      : null
                  }
                  onPress={() => router.push({ pathname: "/provider/[id]" as any, params: { id: String(row.provider.id) } })}
                  colors={colors}
                />
              ))}
            </ScrollView>
          )}
        </Animated.View>
      </ScrollView>

      <AddressPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        addresses={addressesQuery.data ?? []}
        onSelect={(a) => {
          setSelectedAddress(a);
          setPickerOpen(false);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
        colors={colors}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  headerAvatar: { width: 42, height: 42, borderRadius: 21 },
  bellBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  bellBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  bellBadgeText: { fontSize: 9.5, fontWeight: "800", color: "#fff" },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  dot: { height: 6, borderRadius: 3 },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  categoryCard: {
    width: "47%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  categoryIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    maxHeight: "70%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#00000020",
    alignSelf: "center",
    marginBottom: 14,
  },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 12 },
});
