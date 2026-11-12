FROM alpine:3.22
RUN apk add --no-cache \
      openldap=2.6.8-r0 \
      openldap-back-mdb=2.6.8-r0 \
      openldap-clients=2.6.8-r0 \
      openldap-overlay-all=2.6.8-r0 \
 && mkdir -p /var/lib/openldap/openldap-data /run/openldap
COPY slapd.conf /etc/openldap/slapd.conf
EXPOSE 389 636
HEALTHCHECK --interval=2s --timeout=3s --retries=30 \
  CMD ldapsearch -x -H ldap://localhost -b "" -s base namingContexts >/dev/null || exit 1
CMD ["slapd", "-d", "0", "-h", "ldap:/// ldaps:///", "-f", "/etc/openldap/slapd.conf"]
