import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/tag-input";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

type Certification = { title: string; issuer?: string; year?: number };

const AVAILABILITY = [
  { key: "available", label: "Available", icon: "check-circle" as const },
  { key: "busy", label: "Busy", icon: "do-not-disturb-on" as const },
  { key: "offline", label: "Offline", icon: "power-settings-new" as const },
] as const;

export default function ProviderProfileScreen() {
  const colors = useColors();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const profileQuery = trpc.provider.myProfile.useQuery(undefined, { enabled: isAuthenticated });
  const documentsQuery = trpc.provider.myDocuments.useQuery(undefined, { enabled: isAuthenticated });
  const updateMutation = trpc.provider.updateProfile.useMutation({
    onSuccess: () => {
      utils.provider.myProfile.invalidate();
      utils.provider.dashboard.invalidate();
    },
  });
  const uploadFileMutation = trpc.uploads.file.useMutation();
  const uploadDocMutation = trpc.provider.uploadDocument.useMutation({
    onSuccess: () => {
      utils.provider.myDocuments.invalidate();
      utils.provider.myProfile.invalidate();
    },
  });

  const [businessName, setBusinessName] = useState("");
  const [bio, setBio] = useState("");
  const [years, setYears] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [availability, setAvailability] = useState<"available" | "busy" | "offline">("offline");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [residentialAddress, setResidentialAddress] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [cacNumber, setCacNumber] = useState("");
  const [serviceRadiusKm, setServiceRadiusKm] = useState("");
  const [serviceAreas, setServiceAreas] = useState<string[]>([]);
  const [travelsToCustomer, setTravelsToCustomer] = useState(true);
  const [customerComesToProvider, setCustomerComesToProvider] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [certTitle, setCertTitle] = useState("");
  const [certIssuer, setCertIssuer] = useState("");
  const [certYear, setCertYear] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const profile = profileQuery.data;

  useEffect(() => {
    if (profile && !prefilled) {
      setBusinessName(profile.businessName);
      setBio(profile.bio ?? "");
      setYears(String(profile.yearsOfExperience ?? 0));
      setCity(profile.city ?? "");
      setStateName(profile.state ?? "");
      setAvailability(profile.availabilityStatus as any);
      setFirstName((profile as any).firstName ?? "");
      setLastName((profile as any).lastName ?? "");
      setDob((profile as any).dateOfBirth ?? "");
      setPhone((profile as any).phone ?? "");
      setEmail((profile as any).email ?? "");
      setResidentialAddress((profile as any).residentialAddress ?? "");
      setBusinessAddress((profile as any).businessAddress ?? "");
      setCacNumber((profile as any).cacRegistrationNumber ?? "");
      setServiceRadiusKm((profile as any).serviceRadiusKm != null ? String((profile as any).serviceRadiusKm) : "");
      setServiceAreas((profile as any).serviceAreas ?? []);
      setTravelsToCustomer((profile as any).travelsToCustomer ?? true);
      setCustomerComesToProvider((profile as any).customerComesToProvider ?? false);
      setSkills((profile as any).skills ?? []);
      setLanguages((profile as any).languages ?? []);
      setCertifications((profile as any).certifications ?? []);
      setPrefilled(true);
    }
  }, [profile, prefilled]);

  const save = async () => {
    if (businessName.trim().length < 2) {
      Alert.alert("Business name required", "Please enter your business name.");
      return;
    }
    setSaving(true);
    try {
      await updateMutation.mutateAsync({
        businessName: businessName.trim(),
        bio: bio.trim() || undefined,
        yearsOfExperience: years ? Math.max(0, Math.min(80, parseInt(years, 10) || 0)) : undefined,
        availabilityStatus: availability,
        city: city.trim() || undefined,
        state: stateName.trim() || undefined,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(dob.trim()) ? dob.trim() : undefined,
        phone: phone.trim() || undefined,
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim() : undefined,
        residentialAddress: residentialAddress.trim().length >= 5 ? residentialAddress.trim() : undefined,
        businessAddress: businessAddress.trim() || undefined,
        cacRegistrationNumber: cacNumber.trim() || undefined,
        serviceRadiusKm: serviceRadiusKm.trim() ? Math.max(0, Math.min(500, parseInt(serviceRadiusKm, 10) || 0)) : undefined,
        serviceAreas,
        travelsToCustomer,
        customerComesToProvider,
        skills,
        languages,
        certifications,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Your provider profile has been updated.");
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const uploadDoc = async (type: "government_id" | "certificate" | "selfie" | "address_proof") => {
    const doUpload = async (idType?: "nin" | "drivers_licence" | "international_passport" | "voters_card") => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
      if (result.canceled || !result.assets?.[0]?.base64) return;
      setUploadingDoc(true);
      const asset = result.assets[0];
      const fileName = `${type}-${Date.now()}.jpg`;
      const uploaded = await uploadFileMutation.mutateAsync({
        fileName,
        contentType: asset.mimeType ?? "image/jpeg",
        base64: asset.base64 ?? "",
      });
      await uploadDocMutation.mutateAsync({
        type,
        idType,
        fileKey: uploaded.key,
        fileUrl: uploaded.url,
        fileName,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Document submitted", "Our team will review it within 1–2 business days.");
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message ?? "Please try again.");
    } finally {
      setUploadingDoc(false);
    }
    };
    if (type === "government_id") {
      Alert.alert("Which ID are you uploading?", undefined, [
        { text: "NIN slip / card", onPress: () => doUpload("nin") },
        { text: "Driver's licence", onPress: () => doUpload("drivers_licence") },
        { text: "International passport", onPress: () => doUpload("international_passport") },
        { text: "Voter's card", onPress: () => doUpload("voters_card") },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      await doUpload();
    }
  };

  if (profileQuery.isLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }

  if (!profile) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <MaterialIcons name="storefront" size={40} color={colors.muted} />
        <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 18, marginTop: 12 }}>Not a provider yet</Text>
        <View style={{ marginTop: 16 }}>
          <Button title="Become a Provider" onPress={() => router.replace("/provider-app/onboard" as any)} />
        </View>
      </ScreenContainer>
    );
  }

  const verificationTone =
    profile.verificationStatus === "verified"
      ? "success"
      : profile.verificationStatus === "pending"
        ? "warning"
        : profile.verificationStatus === "rejected"
          ? "error"
          : "neutral";
  const rejectionReason = (profile as any).rejectionReason as string | null | undefined;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Provider profile</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Verification status */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12 }]}>
            <MaterialIcons
              name={
                profile.verificationStatus === "verified"
                  ? "verified"
                  : profile.verificationStatus === "rejected"
                    ? "gpp-bad"
                    : "pending-actions"
              }
              size={24}
              color={
                profile.verificationStatus === "verified"
                  ? colors.success
                  : profile.verificationStatus === "rejected"
                    ? colors.error
                    : colors.warning
              }
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", color: colors.foreground }}>Verification</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                {profile.verificationStatus === "verified"
                  ? "Your account is verified"
                  : profile.verificationStatus === "pending"
                    ? "Documents under review — you can't accept bookings yet"
                    : profile.verificationStatus === "rejected"
                      ? "Verification rejected — re-submit your documents"
                      : "Upload your ID — required to accept bookings"}
              </Text>
            </View>
            <Badge label={profile.verificationStatus} tone={verificationTone as any} />
          </View>

          {profile.verificationStatus === "rejected" && rejectionReason && (
            <View style={[styles.card, { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}40`, flexDirection: "row", gap: 10 }]}>
              <MaterialIcons name="error-outline" size={18} color={colors.error} />
              <Text style={{ flex: 1, fontSize: 12, color: colors.foreground, lineHeight: 18 }}>
                Reason: {rejectionReason}
              </Text>
            </View>
          )}

          {/* Documents */}
          {profile.verificationStatus !== "verified" && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => uploadDoc("government_id")}
                disabled={uploadingDoc}
                style={[styles.docBtn, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}
              >
                {uploadingDoc ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <MaterialIcons name="badge" size={18} color={colors.primary} />
                )}
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}>Upload ID</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => uploadDoc("certificate")}
                disabled={uploadingDoc}
                style={[styles.docBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <MaterialIcons name="workspace-premium" size={18} color={colors.muted} />
                <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>Add certificate</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Optional/supplementary — not required to become verified */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Optional verification</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: -4 }}>
              Not required, but a selfie and proof of address can boost trust on your public profile.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                onPress={() => uploadDoc("selfie")}
                disabled={uploadingDoc}
                style={[styles.docBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <MaterialIcons name="face" size={18} color={colors.muted} />
                <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>Add selfie</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => uploadDoc("address_proof")}
                disabled={uploadingDoc}
                style={[styles.docBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <MaterialIcons name="home" size={18} color={colors.muted} />
                <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12 }}>Add address proof</Text>
              </TouchableOpacity>
            </View>
          </View>

          {(documentsQuery.data ?? []).length > 0 && (
            <View style={{ gap: 6 }}>
              {(documentsQuery.data ?? []).map((d) => (
                <View key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <MaterialIcons
                    name={d.status === "approved" ? "check-circle" : d.status === "rejected" ? "cancel" : "hourglass-empty"}
                    size={16}
                    color={d.status === "approved" ? colors.success : d.status === "rejected" ? colors.error : colors.warning}
                  />
                  <Text style={{ fontSize: 12, color: colors.muted, flex: 1 }} numberOfLines={1}>
                    {d.fileName ?? d.type} · {d.status}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Portfolio shortcut */}
          <TouchableOpacity
            onPress={() => router.push("/provider-app/portfolio" as any)}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12 }]}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${colors.primary}12`, alignItems: "center", justifyContent: "center" }}>
              <MaterialIcons name="photo-library" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", color: colors.foreground }}>Portfolio</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>Showcase previous work to win more customers</Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
          </TouchableOpacity>

          {/* Legal identity */}
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground, marginTop: 4 }}>Legal identity</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: -10 }}>
            Kept private. Used only for verification and safety.
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>First name</Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="done"
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Last name</Text>
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="done"
              />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Date of birth</Text>
              <TextInput
                value={dob}
                onChangeText={setDob}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="done"
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Phone</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="done"
              />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="done"
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Residential address</Text>
            <TextInput
              value={residentialAddress}
              onChangeText={setResidentialAddress}
              multiline
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, height: 80, textAlignVertical: "top" }]}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Business address (optional)</Text>
            <TextInput
              value={businessAddress}
              onChangeText={setBusinessAddress}
              multiline
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, height: 80, textAlignVertical: "top" }]}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>CAC registration number (optional)</Text>
            <TextInput
              value={cacNumber}
              onChangeText={setCacNumber}
              autoCapitalize="characters"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="done"
            />
          </View>

          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground, marginTop: 4 }}>Business details</Text>

          {/* Availability */}
          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Availability</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {AVAILABILITY.map((a) => {
                const active = availability === a.key;
                return (
                  <TouchableOpacity
                    key={a.key}
                    onPress={() => setAvailability(a.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.surface,
                        borderColor: active ? colors.primary : colors.border,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      },
                    ]}
                  >
                    <MaterialIcons name={a.icon} size={14} color={active ? "#fff" : colors.muted} />
                    <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : colors.muted }}>{a.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Form */}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Business name *</Text>
            <TextInput
              value={businessName}
              onChangeText={setBusinessName}
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="done"
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>About</Text>
            <TextInput
              value={bio}
              onChangeText={setBio}
              multiline
              numberOfLines={4}
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, height: 100, textAlignVertical: "top" }]}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>Years of experience</Text>
              <TextInput
                value={years}
                onChangeText={(t) => setYears(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="done"
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>City</Text>
              <TextInput
                value={city}
                onChangeText={setCity}
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="done"
              />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>State</Text>
            <TextInput
              value={stateName}
              onChangeText={setStateName}
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="done"
            />
          </View>

          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground, marginTop: 4 }}>Profile depth</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: -10 }}>
            Shown on your public profile to help customers pick you.
          </Text>

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Skills</Text>
            <TagInput values={skills} onChange={setSkills} placeholder="e.g. Pipe fitting" colors={colors} />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Languages</Text>
            <TagInput values={languages} onChange={setLanguages} placeholder="e.g. Yoruba" colors={colors} />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Service mode</Text>
            {(
              [
                { key: "travel", label: "I travel to customers", value: travelsToCustomer, set: setTravelsToCustomer },
                { key: "onsite", label: "Customers can come to me", value: customerComesToProvider, set: setCustomerComesToProvider },
              ] as const
            ).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  opt.set(!opt.value);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}
              >
                <MaterialIcons
                  name={opt.value ? "check-box" : "check-box-outline-blank"}
                  size={22}
                  color={opt.value ? colors.primary : colors.muted}
                />
                <Text style={{ fontSize: 14, color: colors.foreground }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Service areas</Text>
            <TagInput values={serviceAreas} onChange={setServiceAreas} placeholder="e.g. Lekki" colors={colors} />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Travel radius (km, optional)</Text>
            <TextInput
              value={serviceRadiusKm}
              onChangeText={(t) => setServiceRadiusKm(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="done"
            />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Certifications</Text>
            {certifications.map((c, i) => (
              <View
                key={`${c.title}-${i}`}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 }]}
              >
                <MaterialIcons name="workspace-premium" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{c.title}</Text>
                  {(c.issuer || c.year) && (
                    <Text style={{ fontSize: 11.5, color: colors.muted }}>
                      {[c.issuer, c.year ? String(c.year) : null].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => setCertifications(certifications.filter((_, idx) => idx !== i))} hitSlop={6}>
                  <MaterialIcons name="close" size={18} color={colors.muted} />
                </TouchableOpacity>
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={certTitle}
                onChangeText={setCertTitle}
                placeholder="Certification title"
                placeholderTextColor={colors.muted}
                style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={certIssuer}
                onChangeText={setCertIssuer}
                placeholder="Issuer (optional)"
                placeholderTextColor={colors.muted}
                style={[styles.input, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
              <TextInput
                value={certYear}
                onChangeText={(t) => setCertYear(t.replace(/[^0-9]/g, ""))}
                placeholder="Year"
                keyboardType="number-pad"
                placeholderTextColor={colors.muted}
                style={[styles.input, { width: 90, backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              />
              <TouchableOpacity
                onPress={() => {
                  if (!certTitle.trim()) return;
                  setCertifications([
                    ...certifications,
                    { title: certTitle.trim(), issuer: certIssuer.trim() || undefined, year: certYear ? parseInt(certYear, 10) : undefined },
                  ]);
                  setCertTitle("");
                  setCertIssuer("");
                  setCertYear("");
                }}
                disabled={!certTitle.trim()}
                style={[styles.addBtn, { backgroundColor: certTitle.trim() ? colors.primary : colors.border }]}
              >
                <MaterialIcons name="add" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          <Button title={saving ? "Saving…" : "Save changes"} loading={saving} onPress={save} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  docBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  addBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
