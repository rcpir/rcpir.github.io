export const COMPUTE = "https://rcpir.austriaeast.cloudapp.azure.com";
export const PIN_SHA256 = "32c08cb6a12376cdedd70a67197ad769dfb0021c7b05084e03cd38d5e1002f85";
// Retrieval hosts (the same R, params.json is the same for all of them):
export const GITHUB_SITE = "rcpir";                                // https://rcpir.github.io/rc-pir/r/<k>
export const GDRIVE_FILE_ID = "1pX2d4xHLY3ZCsuPp2XO_v79ajAl_AVe_"; // all of R in one Drive file ("anyone with the link")
// all of R in one OneDrive file: its "Anyone with the link" share link (a file link, not a folder link)
export const ONEDRIVE_LINK =
  "https://mailtauacil-my.sharepoint.com/:u:/g/personal/shahars3_mail_tau_ac_il/IQDvNjV6_EisToufD8mniANFAa8FAUzDSlrzQ0mJ7d9myxc?e=LbFSOo";
// all of R in one Dropbox file, here in two copies (one shared link each). Dropbox limits the request rate per file,
// so the client reads column j from copy j mod 2 with up to 24 requests in flight per copy.
export const DROPBOX_LINKS = [
  "https://www.dropbox.com/scl/fi/6wgxzxcsudj12yh1f2me2/rcpir_c4_L4k_R.bin?rlkey=o9u63necrcjj77zzt12kgm1h4",
  "https://www.dropbox.com/scl/fi/2i8kuake0jt571mfrvquh/rcpir_c4_L4k_R2.bin?rlkey=rud3qdl74wf3sdjjvhmhpfw68",
];
