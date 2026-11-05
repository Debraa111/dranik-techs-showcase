import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { DateOfBirthPicker } from "@/components/date-of-birth-picker";
import { isAdultBirthDate } from "@/lib/date-of-birth-utils";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe",
  "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

type IdType = "nin" | "drivers_licence" | "international_passport" | "voters_card";

type UploadedDoc = {
  type: "government_id" | "certificate";
  fileName: string;
  uploading: boolean;
  done: boolean;
  key?: string;
  url?: string;
};

const ID_TYPES: { value: IdType; label: string }[] = [
  { value: "nin", label: "NIN slip / card" },
  { value: "drivers_licence", label: "Driver's licence" },
  { value: "international_passport", label: "International passport" },
  { value: "voters_card", label: "Voter's card" },
];

export default function ProviderOnboardScreen() {
  const colors = useColors();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const myProfileQuery = trpc.provider.myProfile.useQuery(undefined, { enabled: isAuthenticated });
  const onboardMutation = trpc.provider.onboard.useMutation();
  const uploadFileMutation = trpc.uploads.file.useMutation();
  const uploadDocMutation = trpc.provider.uploadDocument.useMutation();

  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [bio, setBio] = useState("");
  const [years, setYears] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Legal identity (mandatory)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [residentialAddress, setResidentialAddress] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [cacNumber, setCacNumber] = useState("");
  const [idType, setIdType] = useState<IdType | null>(null);

  const alreadyProvider = !!myProfileQuery.data;

  const steps = useMemo(
    () => [
      { title: "Identity", icon: "badge" as const },
      { title: "Business info", icon: "storefront" as const },
      { title: "Location", icon: "place" as const },
      { title: "Verification", icon: "verified-user" as const },
    ],
    [],
  );

  const dobFormatValid = /^\d{4}-\d{2}-\d{2}$/.test(dob.trim());
  const dobAgeValid = dobFormatValid && isAdultBirthDate(dob.trim());
  const dobValid = dobFormatValid && dobAgeValid;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const identityValid =
    firstName.trim().length >= 1 &&
    lastName.trim().length >= 1 &&
    dobValid &&
    phone.trim().length >= 7 &&
    emailValid &&
    residentialAddress.trim().length >= 5;
  const govIdUploaded = docs.some((d) => d.type === "government_id" && d.done);

  const canContinue =
    step === 0
      ? identityValid
      : step === 1
        ? businessName.trim().length >= 2
        : step === 2
          ? city.trim().length >= 2 && stateName.length > 0
          : true;

  const canSubmit = !!idType && govIdUploaded;

  const pickAndUpload = async (type: "government_id" | "certificate") => {
    if (type === "government_id" && !idType) {
      Alert.alert("Select ID type", "Choose which government ID you are uploading first.");
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]?.base64) return;
      const asset = result.assets[0];
      const fileName = `${type}-${Date.now()}.jpg`;
      setDocs((d) => [...d, { type, fileName, uploading: true, done: false }]);
      const uploaded = await uploadFileMutation.mutateAsync({
        fileName,
        contentType: asset.mimeType ?? "image/jpeg",
        base64: asset.base64 ?? "",
      });
      // Store pending doc info locally; actual document record created after onboard.
      setDocs((d) =>
        d.map((doc) =>
          doc.fileName === fileName ? { ...doc, uploading: false, done: true, key: uploaded.key, url: uploaded.url } : doc,
        ),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setDocs((d) => d.filter((doc) => !doc.uploading));
      Alert.alert("Upload failed", e?.message ?? "Could not upload the document. Please try again.");
    }
  };

  const submit = async () => {
    if (!canSubmit) {
      Alert.alert(
        "Verification required",
        "Select your ID type and upload a government-issued ID. This is mandatory to protect customers on the platform.",
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (!alreadyProvider) {
        await onboardMutation.mutateAsync({
          businessName: businessName.trim(),
          bio: bio.trim() || undefined,
          yearsOfExperience: years ? Math.max(0, Math.min(80, parseInt(years, 10) || 0)) : undefined,
          city: city.trim() || undefined,
          state: stateName || undefined,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: dob.trim(),
          phone: phone.trim(),
          email: email.trim(),
          residentialAddress: residentialAddress.trim(),
          businessAddress: businessAddress.trim() || undefined,
          cacRegistrationNumber: cacNumber.trim() || undefined,
        });
      }
      // Register uploaded documents (marks verification pending)
      for (const doc of docs) {
        if (doc.done && doc.key && doc.url) {
          await uploadDocMutation.mutateAsync({
            type: doc.type,
            idType: doc.type === "government_id" ? (idType ?? undefined) : undefined,
            fileKey: doc.key,
            fileUrl: doc.url,
            fileName: doc.fileName,
            mimeType: "image/jpeg",
          });
        }
      }
      await utils.provider.myProfile.invalidate();
      await utils.auth.me.invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/provider-app/dashboard" as any);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || myProfileQuery.isLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="items-center justify-center p-6">
        <MaterialIcons name="lock" size={40} color={colors.muted} />
        <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700", marginTop: 12 }}>Sign in required</Text>
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 6 }}>
          Sign in to start earning as a service provider.
        </Text>
        <View style={{ marginTop: 20 }}>
          <Button title="Go to sign in" onPress={() => router.replace("/welcome" as any)} />
        </View>
      </ScreenContainer>
    );
  }

  if (alreadyProvider) {
    return (
      <ScreenContainer edges={["top", "left", "right"]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Provider account</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: `${colors.primary}12`, alignItems: "center", justifyContent: "center" }}>
            <MaterialIcons name="verified-user" size={36} color={colors.primary} />
          </View>
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>You&apos;re already a provider</Text>
          <Text style={{ color: colors.muted, textAlign: "center" }}>
            Your provider account for {myProfileQuery.data?.businessName} is active.
          </Text>
          <View style={{ marginTop: 8, alignSelf: "stretch" }}>
            <Button title="Open Provider Dashboard" onPress={() => router.replace("/provider-app/dashboard" as any)} />
          </View>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => (step > 0 ? setStep(step - 1) : router.back())}
            style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <MaterialIcons name="arrow-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Become a Provider</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Step indicator */}
        <View style={{ flexDirection: "row", paddingHorizontal: 20, gap: 8, marginBottom: 8 }}>
          {steps.map((s, i) => (
            <View key={s.title} style={{ flex: 1, gap: 6 }}>
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: i <= step ? colors.primary : colors.border,
                }}
              />
              <Text style={{ fontSize: 11, fontWeight: i === step ? "700" : "500", color: i <= step ? colors.primary : colors.muted }}>
                {s.title}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <View style={{ gap: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>Your legal identity</Text>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                For customer safety, every provider must be legally identifiable. This information is kept private and
                used only for verification.
              </Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[styles.label, { color: colors.foreground }]}>First name *</Text>
                  <TextInput
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First name"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                    returnKeyType="done"
                  />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[styles.label, { color: colors.foreground }]}>Last name *</Text>
                  <TextInput
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last name"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                    returnKeyType="done"
                  />
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Date of birth *</Text>
                <DateOfBirthPicker value={dob} onChange={setDob} />
                {dob.length > 0 && !dobFormatValid && (
                  <Text style={{ fontSize: 12, color: colors.error }}>Use the format YYYY-MM-DD</Text>
                )}
                {dob.length > 0 && dobFormatValid && !dobAgeValid && (
                  <Text style={{ fontSize: 12, color: colors.error }}>You must be between 18 and 100 years old</Text>
                )}
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Phone number *</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="e.g. 0803 123 4567"
                  placeholderTextColor={colors.muted}
                  keyboardType="phone-pad"
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  returnKeyType="done"
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Email address *</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  returnKeyType="done"
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Residential address *</Text>
                <TextInput
                  value={residentialAddress}
                  onChangeText={setResidentialAddress}
                  placeholder="House number, street, area"
                  placeholderTextColor={colors.muted}
                  multiline
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, height: 80, textAlignVertical: "top" }]}
                />
              </View>
            </View>
          )}

          {step === 1 && (
            <View style={{ gap: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>Tell us about your business</Text>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                This is what customers will see when they browse your services.
              </Text>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Business name *</Text>
                <TextInput
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholder="e.g. Adewale Home Repairs"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  returnKeyType="done"
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>About your services</Text>
                <TextInput
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Describe your experience and what you offer…"
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={4}
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, height: 110, textAlignVertical: "top" }]}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Years of experience</Text>
                <TextInput
                  value={years}
                  onChangeText={(t) => setYears(t.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 5"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  returnKeyType="done"
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>CAC registration number (optional)</Text>
                <TextInput
                  value={cacNumber}
                  onChangeText={setCacNumber}
                  placeholder="e.g. RC1234567"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  returnKeyType="done"
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Business address (optional)</Text>
                <TextInput
                  value={businessAddress}
                  onChangeText={setBusinessAddress}
                  placeholder="Shop / office address if different from home"
                  placeholderTextColor={colors.muted}
                  multiline
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, height: 80, textAlignVertical: "top" }]}
                />
              </View>
            </View>
          )}

          {step === 2 && (
            <View style={{ gap: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>Where do you operate?</Text>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                Customers near you will see your services first.
              </Text>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>City *</Text>
                <TextInput
                  value={city}
                  onChangeText={setCity}
                  placeholder="e.g. Ikeja"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  returnKeyType="done"
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>State *</Text>
                <TouchableOpacity
                  onPress={() => setStatePickerOpen(!statePickerOpen)}
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                >
                  <Text style={{ color: stateName ? colors.foreground : colors.muted }}>
                    {stateName || "Select your state"}
                  </Text>
                  <MaterialIcons name={statePickerOpen ? "expand-less" : "expand-more"} size={20} color={colors.muted} />
                </TouchableOpacity>
                {statePickerOpen && (
                  <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, maxHeight: 240, overflow: "hidden" }}>
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }}>
                      {NIGERIAN_STATES.map((s) => (
                        <TouchableOpacity
                          key={s}
                          onPress={() => {
                            setStateName(s);
                            setStatePickerOpen(false);
                          }}
                          style={{ paddingVertical: 12, paddingHorizontal: 16, backgroundColor: s === stateName ? `${colors.primary}12` : colors.surface }}
                        >
                          <Text style={{ color: s === stateName ? colors.primary : colors.foreground, fontWeight: s === stateName ? "700" : "400" }}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            </View>
          )}

          {step === 3 && (
            <View style={{ gap: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>Verify your identity</Text>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                Upload a government-issued ID. This is mandatory — you will not be able to accept bookings or send
                quotations until our team verifies your identity.
              </Text>

              <View style={{ gap: 8 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Which ID are you uploading? *</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {ID_TYPES.map((t) => (
                    <TouchableOpacity
                      key={t.value}
                      onPress={() => {
                        setIdType(t.value);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: idType === t.value ? colors.primary : colors.border,
                        backgroundColor: idType === t.value ? `${colors.primary}15` : colors.surface,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: idType === t.value ? "700" : "500", color: idType === t.value ? colors.primary : colors.foreground }}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {(["government_id", "certificate"] as const).map((type) => {
                const uploaded = docs.filter((d) => d.type === type);
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => pickAndUpload(type)}
                    style={[styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.primary}12`, alignItems: "center", justifyContent: "center" }}>
                      <MaterialIcons name={type === "government_id" ? "badge" : "workspace-premium"} size={22} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontWeight: "700", color: colors.foreground }}>
                        {type === "government_id" ? "Government ID *" : "Certificates (optional)"}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        {uploaded.length > 0
                          ? uploaded.some((d) => d.uploading)
                            ? "Uploading…"
                            : `${uploaded.filter((d) => d.done).length} file(s) uploaded`
                          : "Tap to upload a photo"}
                      </Text>
                    </View>
                    {uploaded.some((d) => d.uploading) ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : uploaded.some((d) => d.done) ? (
                      <MaterialIcons name="check-circle" size={22} color={colors.success} />
                    ) : (
                      <MaterialIcons name="upload" size={22} color={colors.muted} />
                    )}
                  </TouchableOpacity>
                );
              })}

              <View style={[styles.infoBox, { backgroundColor: `${colors.primary}0D`, borderColor: `${colors.primary}30` }]}>
                <MaterialIcons name="info" size={18} color={colors.primary} />
                <Text style={{ flex: 1, fontSize: 12, color: colors.foreground, lineHeight: 18 }}>
                  Our team reviews documents within 1–2 business days. You can set up services while verification is in
                  progress, but accepting bookings is unlocked only after you are verified.
                </Text>
              </View>
            </View>
          )}

          {error && (
            <View style={[styles.infoBox, { backgroundColor: `${colors.error}10`, borderColor: `${colors.error}40` }]}>
              <MaterialIcons name="error-outline" size={18} color={colors.error} />
              <Text style={{ flex: 1, fontSize: 13, color: colors.error }}>{error}</Text>
            </View>
          )}

          {step < 3 ? (
            <Button
              title="Continue"
              disabled={!canContinue}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setStep(step + 1);
              }}
            />
          ) : (
            <Button
              title={submitting ? "Creating your account…" : "Submit for verification"}
              loading={submitting}
              disabled={!canSubmit}
              onPress={submit}
            />
          )}
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
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  infoBox: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "flex-start",
  },
});
