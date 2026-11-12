# Active Directory checklist

CI has no Active Directory, so these checks are done by hand against a real domain controller (task 14.3). Run them with a packaged build from `pnpm dist`. Record each result as **Pass**, **Fail** (with a note) or **Skipped** (with the reason), together with the date and the build.

Use a test OU you are allowed to create and delete in, written below as `OU=ldap-studio-test,<domain DN>`. Don't record host names, account names or passwords in this file. Write placeholders such as "DC A" instead.

| Date | Build | Domain controller (placeholder) | Windows Server version | Tester |
| ---- | ----- | ------------------------------- | ---------------------- | ------ |
|      |       |                                 |                        |        |

## 1. Simple bind over LDAPS

| #   | Step                                                                                          | Expected                                                                                                   | Result |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| 1.1 | Create a profile: port 636, encryption LDAPS, bind DN in UPN form (`user@domain`) or as a DN. | The profile is saved. The password field shows "saved".                                                    |        |
| 1.2 | Connect while the domain CA is not trusted by the OS or the profile.                          | The certificate prompt shows subject, issuer, validity and fingerprint. Nothing is sent before you decide. |        |
| 1.3 | Import the domain's CA certificate into the profile and connect again.                        | The connection succeeds without a prompt.                                                                  |        |
| 1.4 | Connect with a wrong password.                                                                | "Invalid credentials" with AD's diagnostic text (`data 52e`). The profile stays disconnected.              |        |
| 1.5 | Connect over StartTLS on port 389.                                                            | It connects if the DC supports StartTLS. Otherwise it shows a clear error.                                 |        |

## 2. Paging past the 1,000-entry limit

AD returns at most 1,000 entries per page (`MaxPageSize`).

| #   | Step                                                                                                                            | Expected                                                                                                 | Result |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| 2.1 | Expand a container with more than 1,000 children (for example `CN=Users` in a large domain, or a test OU filled with a script). | All children load in pages, the count matches the server's, and the tree stays responsive while loading. |        |
| 2.2 | Cancel the load halfway.                                                                                                        | Loading stops. The children loaded so far stay visible and are marked incomplete.                        |        |
| 2.3 | Search the domain root for `(objectClass=user)` with the size limit above 1,000.                                                | Results stream in past 1,000. The status shows the total.                                                |        |
| 2.4 | Run the same search with a size limit of 1,500.                                                                                 | It stops at 1,500 and says the size limit was reached.                                                   |        |

## 3. Binary values

| #   | Step                                                                 | Expected                                                                                                                   | Result |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| 3.1 | Open a user entry.                                                   | `objectGUID` is shown as a GUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) that matches `Get-ADUser … \| Select ObjectGUID`. |        |
| 3.2 | Same entry.                                                          | `objectSid` is shown as `S-1-5-21-…` and matches `Get-ADUser … \| Select SID`.                                             |        |
| 3.3 | Open a user with `thumbnailPhoto`.                                   | A thumbnail is shown. "Save to file" writes a byte-identical image.                                                        |        |
| 3.4 | Change another attribute of that user (e.g. `description`) and save. | `objectGUID`, `objectSid` and `thumbnailPhoto` are unchanged on the server.                                                |        |
| 3.5 | Open a user with `userCertificate`.                                  | The certificate is decoded: subject, issuer, validity.                                                                     |        |

## 4. Tree Delete

| #   | Step                                                                                   | Expected                                                                                                                                                                                            | Result |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 4.1 | In the test OU, create a sub-OU with a few child objects (users, groups, a nested OU). | All are created.                                                                                                                                                                                    |        |
| 4.2 | Delete the sub-OU with "Delete…" and include its children.                             | The dialog lists the child count. The server deletes the whole subtree with the Tree Delete control: the operation log shows a single delete for the sub-OU, not one per child. The tree refreshes. |        |
| 4.3 | Repeat with a bind account that may not delete one of the children.                    | The delete stops. The report says how many entries were deleted and which one failed. The tree refreshes.                                                                                           |        |

## 5. Schema

| #   | Step                                                            | Expected                                                                                                                              | Result |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 5.1 | Connect and open a user.                                        | Required and optional attributes come from the AD schema. "Add attribute" suggests AD attributes such as `sAMAccountName`.            |        |
| 5.2 | In the search filter, type `(sAMAcc`.                           | `sAMAccountName` is suggested.                                                                                                        |        |
| 5.3 | Create a new entry with the object class `user` in the test OU. | Required attributes (such as `cn`, `sAMAccountName` where the DC needs it) are marked. Creating succeeds or shows AD's error clearly. |        |
| 5.4 | Disconnect and connect again.                                   | The schema loads again without errors in the operation log.                                                                           |        |

## 6. Editing and stale detection

| #   | Step                                                                                                 | Expected                                                                                     | Result |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| 6.1 | Edit `description` of a test user and save.                                                          | The review lists one change. The server has the new value.                                   |        |
| 6.2 | Open a test user, change it in another tool (ADUC or PowerShell), then save a change in LDAP Studio. | The editor reports that the entry changed (via `uSNChanged`) and offers reload or overwrite. |        |
| 6.3 | Rename a test user (change its `CN`) and move it to another OU in the test OU.                       | Both succeed. The tree shows the new location.                                               |        |

## Notes

Record failures, AD diagnostic messages, and anything unexpected here.
