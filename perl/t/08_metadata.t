#!/usr/bin/env perl

use strict;
use warnings FATAL => 'all';
use v5.20;

use Test::More;
use FindBin qw($Bin);

# Read Makefile.PL and extract repository web URL
my $makefile_pl = "$Bin/../Makefile.PL";
ok(-f $makefile_pl, 'Makefile.PL exists');

open my $fh, '<', $makefile_pl or die "Cannot open $makefile_pl: $!";
my $content = do { local $/; <$fh> };
close $fh;

# Extract repository web URL
if ($content =~ /web\s*=>\s*'([^']+)'/) {
    my $web_url = $1;

    # Verify the URL uses the correct branch name (master, not main)
    like($web_url, qr{/tree/master/}, 'Repository web URL references master branch');
    unlike($web_url, qr{/tree/main/}, 'Repository web URL does not reference non-existent main branch');
}
else {
    fail('Could not extract repository web URL from Makefile.PL');
}

# Extract all GitHub URLs and verify none reference the wrong branch
my @urls;
while ($content =~ m{(https://github\.com/json-structure/sdk[^'"\s]*)}g) {
    push @urls, $1;
}

ok(scalar @urls > 0, 'Found GitHub URLs in Makefile.PL');

for my $url (@urls) {
    if ($url =~ m{/tree/}) {
        like($url, qr{/tree/master/}, "URL $url uses master branch");
    }
}

done_testing();
