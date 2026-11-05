import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNaira } from "@/components/service-card";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { trpc } from "@/lib/trpc";
import { distanceKm, formatDistance } from "@/lib/geo";

const HERO_HEIGHT = 130;
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type ColorPalette = ReturnType<typeof useColors>;

function cardStyle(colors: ColorPalette) {
  return [styles.card, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }];
}

function SectionTitle({ children, colors }: { children: ReactNode; colors: ColorPalette }) {
  return <Text style={{ fontSize: 15.5, fontWeight: "800" as const, color: colors.foreground }}>{children}</Text>;
}

function ChipRow({ items, colors }: { items: string[]; colors: ColorPalette }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {items.map((item) => (
        <View key={item} style={[styles.chip, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.foreground }}>{item}</Text>
        </View>
      ))}
    </View>
  );
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

function ReviewRow({
  review,
  customer,
  colors,
}: {
  review: { id: number; rating: number; comment: string | null; images?: string[] | null; createdAt: Date | string; providerResponse?: string | null };
  customer: { name: string | null; avatarUrl: string | null };
  colors: ColorPalette;
}) {
  return (
    <View style={[styles.reviewCard, { borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {customer.avatarUrl ? (
          <Image source={{ uri: customer.avatarUrl }} style={styles.reviewAvatar} transition={200} />
        ) : (
          <View style={[styles.reviewAvatar, styles.avatarFallback, { backgroundColor: `${colors.primary}18` }]}>
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
      {review.providerResponse && (
        <View style={[styles.responseBox, { backgroundColor: `${colors.primary}0A`, borderColor: `${colors.primary}25` }]}>
          <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.primary }}>Provider response</Text>
          <Text style={{ fontSize: 12.5, color: colors.foreground, marginTop: 3, lineHeight: 18 }}>{review.providerResponse}</Text>
        </View>
      )}
    </View>
  );
}

export default function PublicProviderProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const providerId = Number(id);

  const [reviewsExpanded, setReviewsExpanded] = useState(false);

  const profileQuery = trpc.providers.publicProfile.useQuery({ id: providerId }, { enabled: !!providerId });
  const data = profileQuery.data;

  const startConversation = trpc.messages.start.useMutation();
  const handleMessage = async () => {
    if (!data) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isAuthenticated) {
      router.push("/welcome" as any);
      return;
    }
    const conversation = await startConversation.mutateAsync({ providerId: data.profile.id });
    router.push({ pathname: "/chat/[id]" as any, params: { id: String(conversation.id) } });
  };

  if (profileQuery.isLoading) {
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

  if (!data) {
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
          <EmptyState icon="error-outline" title="Provider not found" description="This profile may no longer be available." />
        </View>
      </ScreenContainer>
    );
  }

  const { profile, completedJobs, services, reviews, workingHours, portfolio } = data;
  const reviewsToShow = reviewsExpanded ? reviews : reviews.slice(0, 3);
  const distance =
    location.coords && profile.latitude && profile.longitude
      ? distanceKm(location.coords.latitude, location.coords.longitude, parseFloat(profile.latitude), parseFloat(profile.longitude))
      : null;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.imageWrap}>
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.55)"]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          <View style={styles.imageTopBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.overlayIconBtn}>
              <MaterialIcons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, marginTop: -50, gap: 20 }}>
          {/* Identity card */}
          <View style={[cardStyle(colors), { flexDirection: "row", alignItems: "center", gap: 14 }]}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} transition={200} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: `${colors.primary}18` }]}>
                <MaterialIcons name="storefront" size={28} color={colors.primary} />
              </View>
            )}
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, flexShrink: 1 }} numberOfLines={1}>
                  {profile.businessName}
                </Text>
                {profile.verificationStatus === "verified" && <MaterialIcons name="verified" size={17} color={colors.primary} />}
              </View>
              <Text style={{ fontSize: 12.5, color: colors.muted }} numberOfLines={1}>
                {[profile.city, profile.state].filter(Boolean).join(", ") || "Nigeria"}
                {distance !== null ? ` · ${formatDistance(distance)}` : ""}
              </Text>
            </View>
          </View>

          {/* Stats */}
          <View style={[cardStyle(colors), styles.statsRow]}>
            <View style={styles.statBlock}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <MaterialIcons name="star" size={14} color="#F59E0B" />
                <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>
                  {parseFloat(profile.averageRating).toFixed(1)}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.muted }}>{profile.reviewCount} reviews</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statBlock}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>{completedJobs}</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>Jobs Done</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statBlock}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>{profile.yearsOfExperience}</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>Years Exp.</Text>
            </View>
          </View>

          {/* Bio */}
          {profile.bio && (
            <View style={cardStyle(colors)}>
              <SectionTitle colors={colors}>About</SectionTitle>
              <Text style={{ fontSize: 14, lineHeight: 21, color: colors.foreground, marginTop: 8 }}>{profile.bio}</Text>
            </View>
          )}

          {/* Skills / languages / certifications */}
          {(profile.skills?.length || profile.languages?.length || profile.certifications?.length) ? (
            <View style={cardStyle(colors)}>
              {profile.skills && profile.skills.length > 0 && (
                <View>
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.muted }}>SKILLS</Text>
                  <ChipRow items={profile.skills} colors={colors} />
                </View>
              )}
              {profile.languages && profile.languages.length > 0 && (
                <View style={{ marginTop: profile.skills?.length ? 16 : 0 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.muted }}>LANGUAGES</Text>
                  <ChipRow items={profile.languages} colors={colors} />
                </View>
              )}
              {profile.certifications && profile.certifications.length > 0 && (
                <View style={{ marginTop: profile.skills?.length || profile.languages?.length ? 16 : 0, gap: 8 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.muted }}>CERTIFICATIONS</Text>
                  {profile.certifications.map((c, i) => (
                    <View key={`${c.title}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <MaterialIcons name="workspace-premium" size={16} color={colors.primary} />
                      <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }} numberOfLines={1}>
                        {c.title}
                        {(c.issuer || c.year) && (
                          <Text style={{ color: colors.muted }}>
                            {"  ·  "}
                            {[c.issuer, c.year ? String(c.year) : null].filter(Boolean).join(" · ")}
                          </Text>
                        )}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {/* Service areas */}
          {(profile.serviceAreas?.length || profile.serviceRadiusKm != null) ? (
            <View style={cardStyle(colors)}>
              <SectionTitle colors={colors}>Coverage</SectionTitle>
              {profile.serviceAreas && profile.serviceAreas.length > 0 && <ChipRow items={profile.serviceAreas} colors={colors} />}
              {profile.serviceRadiusKm != null && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
                  <MaterialIcons name="social-distance" size={16} color={colors.muted} />
                  <Text style={{ fontSize: 12.5, color: colors.muted }}>Travels up to {profile.serviceRadiusKm} km</Text>
                </View>
              )}
            </View>
          ) : null}

          {/* Working hours */}
          {workingHours.length > 0 && (
            <View style={cardStyle(colors)}>
              <SectionTitle colors={colors}>Working hours</SectionTitle>
              <View style={{ gap: 6, marginTop: 10 }}>
                {workingHours
                  .slice()
                  .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                  .map((row) => (
                    <View key={row.dayOfWeek} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 13, color: colors.foreground }}>{DAY_LABELS[row.dayOfWeek]}</Text>
                      <Text style={{ fontSize: 13, color: row.isOpen ? colors.muted : colors.error, fontWeight: row.isOpen ? "400" : "600" }}>
                        {row.isOpen ? `${row.openTime} – ${row.closeTime}` : "Closed"}
                      </Text>
                    </View>
                  ))}
              </View>
            </View>
          )}

          {/* Portfolio */}
          {portfolio.length > 0 && (
            <View style={{ gap: 12 }}>
              <SectionTitle colors={colors}>Portfolio</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {portfolio.map((item) => {
                  const images = (item.images ?? []) as { url: string; kind: string }[];
                  return (
                  <View key={item.id} style={[styles.portfolioCard, styles.cardShadow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    {images[0] ? (
                      <Image source={{ uri: images[0].url }} style={styles.portfolioImage} contentFit="cover" transition={200} />
                    ) : (
                      <View style={[styles.portfolioImage, styles.avatarFallback, { backgroundColor: `${colors.primary}12` }]}>
                        <MaterialIcons name="photo" size={24} color={colors.primary} />
                      </View>
                    )}
                    <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.foreground, padding: 8 }} numberOfLines={1}>
                      {item.title}
                    </Text>
                  </View>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Services */}
          {services.length > 0 && (
            <View style={{ gap: 12 }}>
              <SectionTitle colors={colors}>Services ({services.length})</SectionTitle>
              <View style={{ gap: 10 }}>
                {services.map(({ service, category }) => (
                  <TouchableOpacity
                    key={service.id}
                    activeOpacity={0.8}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({ pathname: "/service/[id]" as any, params: { id: String(service.id) } });
                    }}
                    style={[cardStyle(colors), { flexDirection: "row", alignItems: "center", gap: 12 }]}
                  >
                    {service.imageUrl ? (
                      <Image source={{ uri: service.imageUrl }} style={styles.serviceThumb} contentFit="cover" transition={200} />
                    ) : (
                      <View style={[styles.serviceThumb, styles.avatarFallback, { backgroundColor: `${colors.primary}12` }]}>
                        <MaterialIcons name={(category?.icon as any) || "handyman"} size={20} color={colors.primary} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                        {service.title}
                      </Text>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.primary }}>{formatNaira(service.basePrice)}</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={colors.muted} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Reviews */}
          <View style={cardStyle(colors)}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <SectionTitle colors={colors}>Customer Reviews</SectionTitle>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MaterialIcons name="star" size={15} color="#F59E0B" />
                <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.foreground }}>
                  {parseFloat(profile.averageRating).toFixed(1)}
                </Text>
              </View>
            </View>
            <View style={{ gap: 10, marginTop: 12 }}>
              {reviews.length === 0 ? (
                <Text style={{ fontSize: 13, color: colors.muted }}>No reviews yet.</Text>
              ) : (
                <>
                  {reviewsToShow.map(({ review, customer }) => (
                    <ReviewRow key={review.id} review={review} customer={customer} colors={colors} />
                  ))}
                  {!reviewsExpanded && reviews.length > 3 && (
                    <TouchableOpacity onPress={() => setReviewsExpanded(true)} style={{ marginTop: 2 }}>
                      <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13.5 }}>
                        See all {profile.reviewCount} reviews →
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Sticky bar — Message only, no Call button (phone numbers never cross parties) */}
      <View
        style={[
          styles.stickyBar,
          styles.cardShadow,
          { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: insets.bottom + 14 },
        ]}
      >
        <Button
          title="Message"
          size="lg"
          fullWidth
          icon={<MaterialIcons name="chat-bubble-outline" size={17} color="#fff" />}
          loading={startConversation.isPending}
          onPress={handleMessage}
        />
      </View>
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
  imageWrap: { width: "100%", height: HERO_HEIGHT, backgroundColor: "#1a1a1a" },
  imageTopBar: { position: "absolute", top: 12, left: 16, right: 16, flexDirection: "row", justifyContent: "space-between" },
  card: { borderRadius: 22, borderWidth: 1, padding: 18 },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", paddingVertical: 14 },
  statBlock: { flex: 1, alignItems: "center", gap: 2 },
  statDivider: { width: 1, height: "100%" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  reviewCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
  reviewAvatar: { width: 34, height: 34, borderRadius: 17 },
  reviewPhoto: { width: 76, height: 76, borderRadius: 12 },
  responseBox: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  portfolioCard: { width: 150, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  portfolioImage: { width: "100%", height: 100 },
  serviceThumb: { width: 52, height: 52, borderRadius: 12 },
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
