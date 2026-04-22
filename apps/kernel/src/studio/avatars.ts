// ---------------------------------------------------------------------------
// Oscorpex — Avatar Collection
// Sourced from https://www.untitledui.com/avatars (free for commercial use)
// ---------------------------------------------------------------------------

export type Gender = "male" | "female";

export interface AvatarOption {
	name: string;
	url: string;
	gender: Gender;
}

const BASE = "https://untitledui.com/images/avatars";

export const AVATARS: AvatarOption[] = [
	// Female avatars
	{ name: "Olivia Rhye", url: `${BASE}/olivia-rhye`, gender: "female" },
	{ name: "Phoenix Baker", url: `${BASE}/phoenix-baker`, gender: "female" },
	{ name: "Lana Steiner", url: `${BASE}/lana-steiner`, gender: "female" },
	{ name: "Demi Wilkinson", url: `${BASE}/demi-wilkinson`, gender: "female" },
	{ name: "Candice Wu", url: `${BASE}/candice-wu`, gender: "female" },
	{ name: "Natali Craig", url: `${BASE}/natali-craig`, gender: "female" },
	{ name: "Andi Lane", url: `${BASE}/andi-lane`, gender: "female" },
	{ name: "Kate Morrison", url: `${BASE}/kate-morrison`, gender: "female" },
	{ name: "Ava Wright", url: `${BASE}/ava-wright`, gender: "female" },
	{ name: "Eve Leroy", url: `${BASE}/eve-leroy`, gender: "female" },
	{ name: "Rene Wells", url: `${BASE}/rene-wells`, gender: "female" },
	{ name: "Lori Bryson", url: `${BASE}/lori-bryson`, gender: "female" },
	{ name: "Anaiah Whitten", url: `${BASE}/anaiah-whitten`, gender: "female" },
	{ name: "Katherine Moss", url: `${BASE}/katherine-moss`, gender: "female" },
	{ name: "Mollie Hall", url: `${BASE}/mollie-hall`, gender: "female" },
	{ name: "Eva Bond", url: `${BASE}/eva-bond`, gender: "female" },
	{ name: "Sophia Perez", url: `${BASE}/sophia-perez`, gender: "female" },
	{ name: "Kelly Williams", url: `${BASE}/kelly-williams`, gender: "female" },
	{ name: "Lucy Bond", url: `${BASE}/lucy-bond`, gender: "female" },
	{ name: "Alisa Hester", url: `${BASE}/alisa-hester`, gender: "female" },
	{ name: "Aliah Lane", url: `${BASE}/aliah-lane`, gender: "female" },
	{ name: "Amelie Laurent", url: `${BASE}/amelie-laurent`, gender: "female" },
	{ name: "Sienna Hewitt", url: `${BASE}/sienna-hewitt`, gender: "female" },
	{ name: "Caitlyn King", url: `${BASE}/caitlyn-king`, gender: "female" },
	{ name: "Lily Rose", url: `${BASE}/lily-rose-chedjou`, gender: "female" },
	{ name: "Florence Shaw", url: `${BASE}/florence-shaw`, gender: "female" },
	{ name: "Priya Shepard", url: `${BASE}/priya-shepard`, gender: "female" },
	{ name: "Isla Allison", url: `${BASE}/isla-allison`, gender: "female" },
	{ name: "Elisa Nishikawa", url: `${BASE}/elisa-nishikawa`, gender: "female" },
	{ name: "Molly Vaughan", url: `${BASE}/molly-vaughan`, gender: "female" },

	// Male avatars
	{ name: "Drew Cano", url: `${BASE}/drew-cano`, gender: "male" },
	{ name: "Orlando Diggs", url: `${BASE}/orlando-diggs`, gender: "male" },
	{ name: "Koray Okumus", url: `${BASE}/koray-okumus`, gender: "male" },
	{ name: "Zahir Mays", url: `${BASE}/zahir-mays`, gender: "male" },
	{ name: "Joshua Wilson", url: `${BASE}/joshua-wilson`, gender: "male" },
	{ name: "Lyle Kauffman", url: `${BASE}/lyle-kauffman`, gender: "male" },
	{ name: "Loki Bright", url: `${BASE}/loki-bright`, gender: "male" },
	{ name: "Eduard Franz", url: `${BASE}/eduard-franz`, gender: "male" },
	{ name: "Alec Whitten", url: `${BASE}/alec-whitten`, gender: "male" },
	{ name: "Julius Vaughan", url: `${BASE}/julius-vaughan`, gender: "male" },
	{ name: "Zaid Schwartz", url: `${BASE}/zaid-schwartz`, gender: "male" },
	{ name: "Ammar Foley", url: `${BASE}/ammar-foley`, gender: "male" },
	{ name: "Olly Schroeder", url: `${BASE}/olly-schroeder`, gender: "male" },
	{ name: "Mikey Lawrence", url: `${BASE}/mikey-lawrence`, gender: "male" },
	{ name: "Ashwin Santiago", url: `${BASE}/ashwin-santiago`, gender: "male" },
	{ name: "Nikolas Gibbons", url: `${BASE}/nikolas-gibbons`, gender: "male" },
	{ name: "Ethan Campbell", url: `${BASE}/ethan-campbell`, gender: "male" },
	{ name: "Hasan Johns", url: `${BASE}/hasan-johns`, gender: "male" },
	{ name: "Levi Rocha", url: `${BASE}/levi-rocha`, gender: "male" },
	{ name: "Owen Garcia", url: `${BASE}/owen-garcia`, gender: "male" },
	{ name: "Noah Pierre", url: `${BASE}/noah-pierre`, gender: "male" },
	{ name: "Marco Kelly", url: `${BASE}/marco-kelly`, gender: "male" },
	{ name: "Ethan Valdez", url: `${BASE}/ethan-valdez`, gender: "male" },
	{ name: "Jackson Reed", url: `${BASE}/jackson-reed`, gender: "male" },
	{ name: "Jordan Burgess", url: `${BASE}/jordan-burgess`, gender: "male" },
	{ name: "Nicolas Wang", url: `${BASE}/nicolas-wang`, gender: "male" },
	{ name: "Danyal Lester", url: `${BASE}/danyal-lester`, gender: "male" },
	{ name: "Rayhan Zua", url: `${BASE}/rayhan-zua`, gender: "male" },
	{ name: "Jay Shepard", url: `${BASE}/jay-shepard`, gender: "male" },
	{ name: "Franklin Mays", url: `${BASE}/franklin-mays`, gender: "male" },
];

export const FEMALE_AVATARS = AVATARS.filter((a) => a.gender === "female");
export const MALE_AVATARS = AVATARS.filter((a) => a.gender === "male");

/** Get a deterministic avatar for a given name + gender */
export function getDefaultAvatar(name: string, gender: Gender): string {
	const pool = gender === "female" ? FEMALE_AVATARS : MALE_AVATARS;
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
	}
	return pool[Math.abs(hash) % pool.length].url;
}
