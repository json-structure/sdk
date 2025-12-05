package JSON::Structure::JsonSourceLocator;

use strict;
use warnings;
use v5.20;

our $VERSION = '0.01';

use JSON::Structure::Types;

=head1 NAME

JSON::Structure::JsonSourceLocator - Track line and column positions in JSON documents

=head1 SYNOPSIS

    use JSON::Structure::JsonSourceLocator;
    
    my $locator = JSON::Structure::JsonSourceLocator->new($json_text);
    my $location = $locator->get_location('#/properties/name');
    
    if ($location->is_known) {
        say "Found at line $location->{line}, column $location->{column}";
    }

=head1 DESCRIPTION

This module tracks line and column positions in a JSON document and maps
JSON Pointer paths to source locations. It parses the JSON text to build
a map of paths to character offsets, then converts offsets to line/column
positions.

B<Limitations:> This is a lightweight, hand-rolled JSON path locator optimized
for typical JSON Structure schemas. It may report incorrect positions for:

=over 4

=item * Complex escape sequences in strings (e.g., C<\uXXXX> surrogate pairs)

=item * Deeply nested structures with many embedded strings containing braces/brackets

=item * Non-standard "relaxed" JSON (comments, trailing commas, unquoted keys)

=item * Very large documents where character-by-character parsing is slow

=back

For production use requiring precise positions in complex JSON, consider using
a streaming tokenizer like L<JSON::Streaming::Reader> or L<JSON::SL> that can
report byte offsets during parsing.

=cut

sub new {
    my ($class, $json_text) = @_;
    
    my $self = bless {
        json_text    => $json_text // '',
        line_offsets => [],
    }, $class;
    
    $self->_build_line_offsets();
    
    return $self;
}

=head2 get_location($path)

Returns a JsonLocation object for the given JSON Pointer path.

    my $location = $locator->get_location('#/properties/name');

=cut

sub get_location {
    my ($self, $path) = @_;
    
    return JSON::Structure::Types::JsonLocation->unknown()
        unless defined $path && length($self->{json_text});
    
    # Parse the JSON Pointer path into segments
    my @segments = $self->_parse_json_pointer($path);
    
    # Find the location in the text
    return $self->_find_location_in_text(\@segments);
}

sub _build_line_offsets {
    my ($self) = @_;
    
    my @offsets = (0);  # First line starts at offset 0
    my $text = $self->{json_text};
    
    for (my $i = 0; $i < length($text); $i++) {
        if (substr($text, $i, 1) eq "\n") {
            push @offsets, $i + 1;
        }
    }
    
    $self->{line_offsets} = \@offsets;
}

sub _parse_json_pointer {
    my ($self, $path) = @_;
    
    # Remove leading # if present (JSON Pointer fragment identifier)
    $path =~ s/^#//;
    
    # Handle empty path or just "/"
    return () if !defined $path || $path eq '' || $path eq '/';
    
    my @segments;
    
    for my $segment (split m{/}, $path) {
        next if $segment eq '';
        
        # Unescape JSON Pointer tokens
        $segment =~ s/~1/\//g;
        $segment =~ s/~0/~/g;
        
        # Handle bracket notation (e.g., "required[0]" -> "required", "0")
        if ($segment =~ /^([^\[]+)\[(.+)\]$/) {
            push @segments, $1;
            my $rest = "[$2]";
            
            while ($rest =~ /^\[([^\]]+)\](.*)$/) {
                push @segments, $1;
                $rest = $2;
            }
        }
        else {
            push @segments, $segment;
        }
    }
    
    return @segments;
}

sub _offset_to_location {
    my ($self, $offset) = @_;
    
    return JSON::Structure::Types::JsonLocation->unknown()
        if $offset < 0 || $offset > length($self->{json_text});
    
    my $offsets = $self->{line_offsets};
    
    # Binary search for the line
    my ($low, $high) = (0, $#$offsets);
    
    while ($low < $high) {
        my $mid = int(($low + $high + 1) / 2);
        if ($offsets->[$mid] <= $offset) {
            $low = $mid;
        }
        else {
            $high = $mid - 1;
        }
    }
    
    my $line = $low + 1;  # 1-based line number
    my $column = $offset - $offsets->[$low] + 1;  # 1-based column number
    
    return JSON::Structure::Types::JsonLocation->new(
        line   => $line,
        column => $column,
    );
}

sub _find_location_in_text {
    my ($self, $segments) = @_;
    
    my $text = $self->{json_text};
    my $pos = 0;
    
    # Skip initial whitespace
    $pos = $self->_skip_whitespace($pos);
    
    return JSON::Structure::Types::JsonLocation->unknown()
        if $pos >= length($text);
    
    # If no segments, return the root location
    if (!@$segments) {
        return $self->_offset_to_location($pos);
    }
    
    my $current_pos = $pos;
    
    for my $i (0 .. $#$segments) {
        my $segment = $segments->[$i];
        
        $current_pos = $self->_skip_whitespace($current_pos);
        return JSON::Structure::Types::JsonLocation->unknown()
            if $current_pos >= length($text);
        
        my $char = substr($text, $current_pos, 1);
        
        if ($char eq '{') {
            # Object: find the key
            my $found_pos = $self->_find_object_key($current_pos, $segment);
            return JSON::Structure::Types::JsonLocation->unknown()
                if $found_pos < 0;
            $current_pos = $found_pos;
        }
        elsif ($char eq '[') {
            # Array: find the index
            my $index = $segment;
            return JSON::Structure::Types::JsonLocation->unknown()
                unless $index =~ /^\d+$/;
            
            my $found_pos = $self->_find_array_index($current_pos, int($index));
            return JSON::Structure::Types::JsonLocation->unknown()
                if $found_pos < 0;
            $current_pos = $found_pos;
        }
        else {
            return JSON::Structure::Types::JsonLocation->unknown();
        }
    }
    
    return $self->_offset_to_location($current_pos);
}

sub _skip_whitespace {
    my ($self, $pos) = @_;
    
    my $text = $self->{json_text};
    my $len = length($text);
    
    while ($pos < $len && substr($text, $pos, 1) =~ /[\s\t\n\r]/) {
        $pos++;
    }
    
    return $pos;
}

sub _find_object_key {
    my ($self, $start_pos, $key) = @_;
    
    my $text = $self->{json_text};
    my $len = length($text);
    my $pos = $start_pos;
    
    return -1 if $pos >= $len || substr($text, $pos, 1) ne '{';
    $pos++;  # Skip '{'
    
    while ($pos < $len) {
        $pos = $self->_skip_whitespace($pos);
        return -1 if $pos >= $len;
        
        my $char = substr($text, $pos, 1);
        
        # Check for end of object
        if ($char eq '}') {
            return -1;  # Key not found
        }
        
        # Skip comma
        if ($char eq ',') {
            $pos++;
            next;
        }
        
        # Expect a string key
        if ($char eq '"') {
            my $key_start = $pos;
            my ($parsed_key, $key_end) = $self->_parse_string($pos);
            return -1 if $key_end < 0;
            
            $pos = $key_end;
            $pos = $self->_skip_whitespace($pos);
            
            # Expect colon
            return -1 if $pos >= $len || substr($text, $pos, 1) ne ':';
            $pos++;  # Skip ':'
            
            $pos = $self->_skip_whitespace($pos);
            
            if ($parsed_key eq $key) {
                # Found the key, return position of value
                return $pos;
            }
            
            # Skip the value
            $pos = $self->_skip_value($pos);
            return -1 if $pos < 0;
        }
        else {
            return -1;  # Invalid JSON
        }
    }
    
    return -1;
}

sub _find_array_index {
    my ($self, $start_pos, $target_index) = @_;
    
    my $text = $self->{json_text};
    my $len = length($text);
    my $pos = $start_pos;
    
    return -1 if $pos >= $len || substr($text, $pos, 1) ne '[';
    $pos++;  # Skip '['
    
    my $current_index = 0;
    
    while ($pos < $len) {
        $pos = $self->_skip_whitespace($pos);
        return -1 if $pos >= $len;
        
        my $char = substr($text, $pos, 1);
        
        # Check for end of array
        if ($char eq ']') {
            return -1;  # Index not found
        }
        
        # Skip comma
        if ($char eq ',') {
            $pos++;
            next;
        }
        
        if ($current_index == $target_index) {
            return $pos;  # Found the element
        }
        
        # Skip this value
        $pos = $self->_skip_value($pos);
        return -1 if $pos < 0;
        
        $current_index++;
    }
    
    return -1;
}

sub _parse_string {
    my ($self, $start_pos) = @_;
    
    my $text = $self->{json_text};
    my $len = length($text);
    my $pos = $start_pos;
    
    return ('', -1) if $pos >= $len || substr($text, $pos, 1) ne '"';
    $pos++;  # Skip opening quote
    
    my $result = '';
    
    while ($pos < $len) {
        my $char = substr($text, $pos, 1);
        
        if ($char eq '"') {
            return ($result, $pos + 1);  # Return string and position after closing quote
        }
        elsif ($char eq '\\') {
            $pos++;
            return ('', -1) if $pos >= $len;
            
            my $escaped = substr($text, $pos, 1);
            if ($escaped eq 'n') {
                $result .= "\n";
            }
            elsif ($escaped eq 'r') {
                $result .= "\r";
            }
            elsif ($escaped eq 't') {
                $result .= "\t";
            }
            elsif ($escaped eq 'u') {
                # Unicode escape
                return ('', -1) if $pos + 4 >= $len;
                my $hex = substr($text, $pos + 1, 4);
                if ($hex =~ /^[0-9a-fA-F]{4}$/) {
                    $result .= chr(hex($hex));
                    $pos += 4;
                }
                else {
                    return ('', -1);
                }
            }
            else {
                $result .= $escaped;
            }
        }
        else {
            $result .= $char;
        }
        $pos++;
    }
    
    return ('', -1);  # Unterminated string
}

sub _skip_value {
    my ($self, $start_pos) = @_;
    
    my $text = $self->{json_text};
    my $len = length($text);
    my $pos = $start_pos;
    
    $pos = $self->_skip_whitespace($pos);
    return -1 if $pos >= $len;
    
    my $char = substr($text, $pos, 1);
    
    if ($char eq '"') {
        # String
        my (undef, $end_pos) = $self->_parse_string($pos);
        return $end_pos;
    }
    elsif ($char eq '{') {
        # Object
        return $self->_skip_object($pos);
    }
    elsif ($char eq '[') {
        # Array
        return $self->_skip_array($pos);
    }
    elsif ($char eq 't') {
        # true
        return $pos + 4 if substr($text, $pos, 4) eq 'true';
        return -1;
    }
    elsif ($char eq 'f') {
        # false
        return $pos + 5 if substr($text, $pos, 5) eq 'false';
        return -1;
    }
    elsif ($char eq 'n') {
        # null
        return $pos + 4 if substr($text, $pos, 4) eq 'null';
        return -1;
    }
    elsif ($char =~ /[-0-9]/) {
        # Number
        while ($pos < $len && substr($text, $pos, 1) =~ /[-+0-9.eE]/) {
            $pos++;
        }
        return $pos;
    }
    
    return -1;
}

sub _skip_object {
    my ($self, $start_pos) = @_;
    
    my $text = $self->{json_text};
    my $len = length($text);
    my $pos = $start_pos;
    
    return -1 if $pos >= $len || substr($text, $pos, 1) ne '{';
    $pos++;  # Skip '{'
    
    my $depth = 1;
    
    while ($pos < $len && $depth > 0) {
        my $char = substr($text, $pos, 1);
        
        if ($char eq '"') {
            my (undef, $end_pos) = $self->_parse_string($pos);
            return -1 if $end_pos < 0;
            $pos = $end_pos;
        }
        elsif ($char eq '{') {
            $depth++;
            $pos++;
        }
        elsif ($char eq '}') {
            $depth--;
            $pos++;
        }
        elsif ($char eq '[') {
            my $end_pos = $self->_skip_array($pos);
            return -1 if $end_pos < 0;
            $pos = $end_pos;
        }
        else {
            $pos++;
        }
    }
    
    return $pos;
}

sub _skip_array {
    my ($self, $start_pos) = @_;
    
    my $text = $self->{json_text};
    my $len = length($text);
    my $pos = $start_pos;
    
    return -1 if $pos >= $len || substr($text, $pos, 1) ne '[';
    $pos++;  # Skip '['
    
    my $depth = 1;
    
    while ($pos < $len && $depth > 0) {
        my $char = substr($text, $pos, 1);
        
        if ($char eq '"') {
            my (undef, $end_pos) = $self->_parse_string($pos);
            return -1 if $end_pos < 0;
            $pos = $end_pos;
        }
        elsif ($char eq '[') {
            $depth++;
            $pos++;
        }
        elsif ($char eq ']') {
            $depth--;
            $pos++;
        }
        elsif ($char eq '{') {
            my $end_pos = $self->_skip_object($pos);
            return -1 if $end_pos < 0;
            $pos = $end_pos;
        }
        else {
            $pos++;
        }
    }
    
    return $pos;
}

1;

__END__

=head1 AUTHOR

JSON Structure Project

=head1 LICENSE

MIT License

=cut
