import { useEffect, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { trpc } from "@/lib/trpc";
import { addRecentlyViewed, getFavorites, toggleFavorite } from "@/lib/local-store";
import { distanceKm, formatDistance } from "@/lib/geo";
import { NegotiatePriceSheet } from "@/components/negotiate-price-sheet";

const HERO_HEIGHT = 230;
const CARD_RADIUS = 22;

function formatNaira(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 60) return diffMin <= 1 ? "just now" : `${diffMin} minutes ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek} week${diffWeek === 1 ? "" : "s"} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? "" : "s"} ago`;
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear} year${diffYear === 1 ? "" : "s"} ago`;
}

type ColorPalette = ReturnType<typeof useColors>;

function cardTitleStyle(colors: ColorPalette) {
  return { fontSize: 15.5, fontWeight: "800" as const, color: colors.foreground };
}

/** Hero image area: swipeable multi-photo carousel with arrows + thumbnails, or a single image/icon fallback. */
function ServiceGallery({
  images,
  categoryName,
  categoryIcon,
  colors,
  isFavorite,
  onToggleFavorite,
  onBack,
}: {
  images: string[];
  categoryName?: string | null;
  categoryIcon?: string | null;
  colors: ColorPalette;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onBack: () => void;
}) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const goTo = (target: number) => {
    const clamped = ((target % images.length) + images.length) % images.length;
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
    setIndex(clamped);
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <View>
      <View style={styles.imageWrap}>
        {images.length > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
          >
            {images.map((uri, i) => (
              <Image key={i} source={{ uri }} style={[styles.image, { width }]} contentFit="cover" transition={250} />
            ))}
          </ScrollView>
        ) : (
          <View style={[styles.image, styles.imageFallback, { backgroundColor: `${colors.primary}12` }]}>
            <MaterialIcons name={(categoryIcon as any) || "handyman"} size={40} color={colors.primary} />
          </View>
        )}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.62)"]}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        <View style={styles.imageTopBar}>
          <TouchableOpacity onPress={onBack} style={styles.overlayIconBtn}>
            <MaterialIcons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggleFavorite} style={styles.overlayIconBtn}>
            <MaterialIcons name={isFavorite ? "favorite" : "favorite-border"} size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        {images.length > 1 && (
          <>
            <TouchableOpacity
              onPress={() => goTo(index - 1)}
              style={[styles.overlayIconBtn, styles.arrowBtn, styles.arrowLeft]}
              accessibilityRole="button"
              accessibilityLabel="Previous photo"
            >
              <MaterialIcons name="chevron-left" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => goTo(index + 1)}
              style={[styles.overlayIconBtn, styles.arrowBtn, styles.arrowRight]}
              accessibilityRole="button"
              accessibilityLabel="Next photo"
            >
              <MaterialIcons name="chevron-right" size={24} color="#fff" />
            </TouchableOpacity>
          </>
        )}
        {categoryName && (
          <View style={styles.categoryPill}>
            <Text style={styles.categoryPillText}>{categoryName.toUpperCase()}</Text>
          </View>
        )}
      </View>

      {images.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbRow}
        >
          {images.map((uri, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)} accessibilityRole="button" accessibilityLabel={`Photo ${i + 1}`}>
              <Image
                source={{ uri }}
                style={[styles.thumb, { borderColor: i === index ? colors.primary : "transparent" }]}
                contentFit="cover"
              />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ReviewCard({
  review,
  customer,
  colors,
}: {
  review: { id: number; rating: number; comment: string | null; images?: string[] | null; createdAt: Date | string };
  customer: { name: string | null; avatarUrl: string | null };
  colors: ColorPalette;
}) {
  return (
    <View style={[styles.reviewCard, { borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {customer.avatarUrl ? (
          <Image source={{ uri: customer.avatarUrl }} style={styles.reviewAvatar} transition={200} />
        ) : (
          <View style={[styles.reviewAvatar, styles.reviewAvatarFallback, { backgroundColor: `${colors.primary}18` }]}>
            <MaterialIcons name="person" size={18} color={colors.primary} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", color: colors.foreground, fontSize: 13.5 }} numberOfLines={1}>
            {customer.name ?? "Customer"}
          </Text>
          <Text style={{ fontSize: 11.5, color: colors.muted }}>{formatRelativeTime(review.createdAt)}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 1 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <MaterialIcons key={i} name="star" size={13} color={i < review.rating ? "#F59E0B" : colors.border} />
          ))}
        </View>
      </View>
      {review.comment && (
        <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 19, marginTop: 8 }}>{review.comment}</Text>
      )}
      {review.images && review.images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
          {review.images.map((url) => (
            <Image key={url} source={{ uri: url }} style={styles.reviewPhoto} contentFit="cover" transition={150} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export default function ServiceDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const serviceId = Number(id);

  const [isFavorite, setIsFavorite] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [reviewsExpanded, setReviewsExpanded] = useState(false);
  const [negotiateOpen, setNegotiateOpen] = useState(false);

  const serviceQuery = trpc.services.byId.useQuery({ id: serviceId }, { enabled: !!serviceId });
  const row = serviceQuery.data;

  const reviewsQuery = trpc.services.reviews.useQuery(
    { providerId: row?.provider.id ?? 0 },
    { enabled: !!row },
  );

  const activityQuery = trpc.providers.activity.useQuery(
    { providerId: row?.provider.id ?? 0 },
    { enabled: !!row },
  );

  const similarQuery = trpc.services.list.useQuery(
    { categoryId: row?.service.categoryId ?? 0, limit: 10 },
    { enabled: !!row },
  );

  useEffect(() => {
    if (serviceId) addRecentlyViewed(serviceId);
  }, [serviceId]);

  useEffect(() => {
    if (serviceId) getFavorites().then((ids) => setIsFavorite(ids.includes(serviceId)));
  }, [serviceId]);

  const handleToggleFavorite = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await toggleFavorite(serviceId);
    setIsFavorite(next.includes(serviceId));
  };

  // Calling is disabled until a booking is accepted — customers can only message
  // or negotiate beforehand, and the provider's phone number is never sent to the
  // client (see publicProviderColumns in server/db.ts). See booking/[id].tsx for
  // where a real call button appears once a booking is confirmed.
  const startConversation = trpc.messages.start.useMutation();
  const handleMessage = async () => {
    if (!row) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isAuthenticated) {
      router.push("/welcome" as any);
      return;
    }
    const conversation = await startConversation.mutateAsync({ providerId: row.provider.id });
    router.push({ pathname: "/chat/[id]" as any, params: { id: String(conversation.id) } });
  };

  if (serviceQuery.isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={{ padding: 20, gap: 14 }}>
          <Skeleton width="100%" height={HERO_HEIGHT} borderRadius={20} />
          <Skeleton width="60%" height={22} borderRadius={8} />
          <Skeleton width="40%" height={16} borderRadius={8} />
        </View>
      </ScreenContainer>
    );
  }

  if (!row) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <EmptyState icon="error-outline" title="Service not found" description="This service may have been removed." />
        </View>
      </ScreenContainer>
    );
  }

  const { service, provider, category, providerAvatarUrl } = row;
  const reviews = reviewsQuery.data ?? [];
  const reviewsToShow = reviewsExpanded ? reviews : reviews.slice(0, 3);
  const similarServices = (similarQuery.data ?? []).filter((r) => r.service.id !== serviceId).slice(0, 8);
  const descriptionIsLong = (service.description?.length ?? 0) > 140;
  const lastBookedAt = activityQuery.data?.lastBookedAt;
  const distance =
    location.coords && provider.latitude && provider.longitude
      ? distanceKm(location.coords.latitude, location.coords.longitude, parseFloat(provider.latitude), parseFloat(provider.longitude))
      : null;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        {/* Hero */}
        <ServiceGallery
          images={
            service.images && service.images.length > 0
              ? service.images
              : service.imageUrl
                ? [service.imageUrl]
                : []
          }
          categoryName={category?.name}
          categoryIcon={category?.icon}
          colors={colors}
          isFavorite={isFavorite}
          onToggleFavorite={handleToggleFavorite}
          onBack={() => router.back()}
        />

        <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 24 }}>
          {/* Title / rating / price */}
          <Animated.View entering={FadeInDown.duration(350)} style={{ gap: 8 }}>
            <Text style={{ fontSize: 23, fontWeight: "800", color: colors.foreground, lineHeight: 29 }}>
              {service.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <MaterialIcons name="star" size={15} color="#F59E0B" />
              <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.foreground }}>
                {parseFloat(provider.averageRating).toFixed(1)}
              </Text>
              <Text style={{ fontSize: 13, color: colors.muted }}>({provider.reviewCount} reviews)</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
              <Text style={{ fontSize: 21, fontWeight: "800", color: colors.primary }}>
                {formatNaira(service.basePrice)}
                {service.priceUnit !== "fixed" && (
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>
                    {" "}
                    /{service.priceUnit === "hourly" ? "hr" : "session"}
                  </Text>
                )}
              </Text>
            </View>
          </Animated.View>

          {/* Quick info chips — only real, verifiable data */}
          <Animated.View entering={FadeInDown.delay(60).duration(350)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {provider.verificationStatus === "verified" && (
                <Badge label="Verified Professional" tone="info" icon={<MaterialIcons name="verified" size={13} color={colors.primary} />} />
              )}
              <Badge
                label={provider.availabilityStatus === "available" ? "Available Today" : provider.availabilityStatus === "busy" ? "Busy" : "Unavailable"}
                tone={provider.availabilityStatus === "available" ? "success" : provider.availabilityStatus === "busy" ? "warning" : "neutral"}
                icon={<MaterialIcons name="schedule" size={13} color={provider.availabilityStatus === "available" ? colors.success : provider.availabilityStatus === "busy" ? colors.warning : colors.muted} />}
              />
              {distance !== null ? (
                <Badge label={formatDistance(distance)} tone="neutral" icon={<MaterialIcons name="location-on" size={13} color={colors.muted} />} />
              ) : (
                provider.city && (
                  <Badge label={provider.city} tone="neutral" icon={<MaterialIcons name="location-on" size={13} color={colors.muted} />} />
                )
              )}
              <Badge
                label={`${provider.yearsOfExperience}+ yrs experience`}
                tone="neutral"
                icon={<MaterialIcons name="workspace-premium" size={13} color={colors.muted} />}
              />
            </ScrollView>
          </Animated.View>

          {/* Provider card */}
          <Animated.View entering={FadeInUp.delay(100).duration(350)}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: "/provider/[id]" as any, params: { id: String(provider.id) } });
            }}
            style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              {providerAvatarUrl ? (
                <Image source={{ uri: providerAvatarUrl }} style={styles.providerAvatar} transition={200} />
              ) : (
                <View style={[styles.providerAvatar, styles.providerAvatarFallback, { backgroundColor: `${colors.primary}18` }]}>
                  <MaterialIcons name="storefront" size={26} color={colors.primary} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, flexShrink: 1 }} numberOfLines={1}>
                    {provider.businessName}
                  </Text>
                  {provider.verificationStatus === "verified" && (
                    <MaterialIcons name="verified" size={16} color={colors.primary} />
                  )}
                </View>
                <Text style={{ fontSize: 12.5, color: colors.muted }} numberOfLines={1}>
                  {provider.city ?? "Nigeria"}, {provider.state}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleMessage}
                disabled={startConversation.isPending}
                style={[styles.callBtn, { backgroundColor: `${colors.primary}14` }]}
                accessibilityRole="button"
                accessibilityLabel="Message provider"
              >
                <MaterialIcons name="chat-bubble-outline" size={19} color={colors.primary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
              <View style={styles.statBlock}>
                <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>{provider.yearsOfExperience}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>Years Exp.</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statBlock}>
                <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>{provider.completedJobs}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>Jobs Done</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statBlock}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <MaterialIcons name="star" size={14} color="#F59E0B" />
                  <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>
                    {parseFloat(provider.averageRating).toFixed(1)}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: colors.muted }}>Rating</Text>
              </View>
            </View>

            {lastBookedAt && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
                <MaterialIcons name="bolt" size={14} color={colors.success} />
                <Text style={{ fontSize: 12, color: colors.muted }}>Last booked {formatRelativeTime(lastBookedAt)}</Text>
              </View>
            )}
          </TouchableOpacity>
          </Animated.View>

          {/* Trust row — platform-wide policy, not per-service data */}
          <Animated.View entering={FadeInUp.delay(130).duration(350)} style={{ flexDirection: "row", gap: 14 }}>
            <View style={styles.trustItem}>
              <MaterialIcons name="verified-user" size={17} color={colors.success} />
              <Text style={{ fontSize: 11.5, color: colors.muted, flex: 1 }}>Satisfaction guaranteed</Text>
            </View>
            <View style={styles.trustItem}>
              <MaterialIcons name="event-available" size={17} color={colors.primary} />
              <Text style={{ fontSize: 11.5, color: colors.muted, flex: 1 }}>Free cancellation, 24h notice</Text>
            </View>
          </Animated.View>

          {/* What's included */}
          {service.included && service.included.length > 0 && (
            <Animated.View
              entering={FadeInUp.delay(160).duration(350)}
              style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={cardTitleStyle(colors)}>What&apos;s Included</Text>
              <View style={{ gap: 10, marginTop: 10 }}>
                {service.included.map((item, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MaterialIcons name="check-circle" size={18} color={colors.success} />
                    <Text style={{ flex: 1, fontSize: 14, color: colors.foreground }}>{item}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* About this service */}
          {service.description && (
            <Animated.View
              entering={FadeInUp.delay(190).duration(350)}
              style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={cardTitleStyle(colors)}>About This Service</Text>
              <Text
                numberOfLines={descExpanded ? undefined : 3}
                style={{ fontSize: 14, lineHeight: 21, color: colors.foreground, marginTop: 8 }}
              >
                {service.description}
              </Text>
              {descriptionIsLong && (
                <TouchableOpacity onPress={() => setDescExpanded((v) => !v)}>
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13, marginTop: 8 }}>
                    {descExpanded ? "Read less" : "Read more"}
                  </Text>
                </TouchableOpacity>
              )}
            </Animated.View>
          )}

          {/* Reviews */}
          <Animated.View
            entering={FadeInUp.delay(220).duration(350)}
            style={[styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={cardTitleStyle(colors)}>Customer Reviews</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MaterialIcons name="star" size={15} color="#F59E0B" />
                <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.foreground }}>
                  {parseFloat(provider.averageRating).toFixed(1)}
                </Text>
              </View>
            </View>

            <View style={{ gap: 10, marginTop: 12 }}>
              {reviewsQuery.isLoading ? (
                <Skeleton width="100%" height={70} borderRadius={14} />
              ) : reviews.length === 0 ? (
                <Text style={{ fontSize: 13, color: colors.muted }}>
                  No reviews yet — be the first to book and leave one!
                </Text>
              ) : (
                <>
                  {reviewsToShow.map(({ review, customer }) => (
                    <ReviewCard key={review.id} review={review} customer={customer} colors={colors} />
                  ))}
                  {!reviewsExpanded && reviews.length > 3 && (
                    <TouchableOpacity onPress={() => setReviewsExpanded(true)} style={{ marginTop: 2 }}>
                      <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13.5 }}>
                        See all {provider.reviewCount} reviews â†’
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </Animated.View>

          {/* Similar services */}
          {similarServices.length > 0 && (
            <Animated.View entering={FadeInUp.delay(250).duration(350)} style={{ gap: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>You may also like</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {similarServices.map((r) => (
                  <TouchableOpacity
                    key={r.service.id}
                    activeOpacity={0.8}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({ pathname: "/service/[id]" as any, params: { id: String(r.service.id) } });
                    }}
                    style={[styles.similarCard, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    {r.service.imageUrl ? (
                      <Image source={{ uri: r.service.imageUrl }} style={styles.similarImage} contentFit="cover" transition={200} />
                    ) : (
                      <View style={[styles.similarImage, styles.imageFallback, { backgroundColor: `${colors.primary}12` }]}>
                        <MaterialIcons name={(r.category?.icon as any) || "handyman"} size={26} color={colors.primary} />
                      </View>
                    )}
                    <View style={{ padding: 10, gap: 3 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                        {r.service.title}
                      </Text>
                      <Text style={{ fontSize: 11.5, color: colors.muted }} numberOfLines={1}>
                        {r.provider.businessName}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>
                          {formatNaira(r.service.basePrice)}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                          <MaterialIcons name="star" size={11} color="#F59E0B" />
                          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.foreground }}>
                            {parseFloat(r.provider.averageRating).toFixed(1)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Animated.View>
          )}
        </View>
      </ScrollView>

      {/* Sticky booking bar — never scrolls away */}
      <View
        style={[
          styles.stickyBar,
          styles.cardShadow,
          { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: insets.bottom + 14 },
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 19, fontWeight: "800", color: colors.primary }}>{formatNaira(service.basePrice)}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>~{service.durationMinutes} min job</Text>
        </View>
        <View style={{ marginTop: 14, gap: 10 }}>
          <Button
            title="Book Now"
            size="lg"
            fullWidth
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push({ pathname: "/booking/new", params: { serviceId: String(service.id) } } as any);
            }}
          />
          <Button
            title="Negotiate Price"
            variant="secondary"
            size="lg"
            fullWidth
            icon={<MaterialIcons name="sync-alt" size={16} color={colors.primary} />}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (!isAuthenticated) {
                router.push("/welcome" as any);
                return;
              }
              setNegotiateOpen(true);
            }}
          />
        </View>
      </View>

      <NegotiatePriceSheet
        visible={negotiateOpen}
        onClose={() => setNegotiateOpen(false)}
        providerId={provider.id}
        serviceId={service.id}
        serviceTitle={service.title}
        originalPrice={service.basePrice}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  overlayIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageWrap: { width: "100%", height: HERO_HEIGHT },
  image: { width: "100%", height: "100%" },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  imageTopBar: {
    position: "absolute",
    top: 12,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  categoryPill: {
    position: "absolute",
    bottom: 14,
    left: 16,
    backgroundColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  categoryPillText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  arrowBtn: { position: "absolute", top: "50%", marginTop: -19 },
  arrowLeft: { left: 12 },
  arrowRight: { right: 12 },
  thumbRow: { gap: 8, paddingHorizontal: 20, paddingTop: 10 },
  thumb: { width: 56, height: 56, borderRadius: 10, borderWidth: 2 },
  card: { borderRadius: CARD_RADIUS, borderWidth: 1, padding: 18 },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  providerAvatar: { width: 60, height: 60, borderRadius: 30 },
  providerAvatarFallback: { alignItems: "center", justifyContent: "center" },
  callBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  statsRow: {
    flexDirection: "row",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  statBlock: { flex: 1, alignItems: "center", gap: 2 },
  statDivider: { width: 1, height: "100%" },
  trustItem: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 6 },
  reviewCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
  reviewAvatar: { width: 34, height: 34, borderRadius: 17 },
  reviewAvatarFallback: { alignItems: "center", justifyContent: "center" },
  reviewPhoto: { width: 76, height: 76, borderRadius: 12 },
  similarCard: { width: 150, borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  similarImage: { width: "100%", height: 90 },
  stickyBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
});

// Small helper so card titles stay consistent without redeclaring the style object inline everywhere.
Object.assign(styles, {
  cardTitleStyle: (colors: ColorPalette) => ({ fontSize: 15.5, fontWeight: "800" as const, color: colors.foreground }),
});
